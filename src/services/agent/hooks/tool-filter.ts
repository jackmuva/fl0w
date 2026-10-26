import {
  MAX_ROUTED_TOOL_OPTIONS,
  TOOL_TOKEN_THRESHOLD,
} from '../../../constants';
import type { Fl0wMessage } from '../../../models/agent';
import { mcpToolKey, type McpTool } from '../../../models/mcp';
import { retryModelCall } from '../../utils';
import { toModelMessages } from '../utils/fl0w-message';
import { estimateTextTokens } from './compaction';
import { sessionUsageStore } from '../../../store/session-usage-store';
import {
  generateText,
  jsonSchema,
  Output,
} from 'ai';

const toolTokenLimit = (contextWindow: number): number => Math.floor(contextWindow * TOOL_TOKEN_THRESHOLD);

const toolToText = (tool: McpTool): string => {
  const payload = {
    description: tool.description ?? 'No description provided',
    inputSchema: tool.inputSchema,
  };
  return `${mcpToolKey(tool)}: ${JSON.stringify(payload)}`;
};

const estimateToolTokens = (tools: McpTool[]): number =>
  tools.reduce((total, tool) => total + estimateTextTokens(toolToText(tool)), 0);

const withinToolTokenBudget = (tools: McpTool[], contextWindow: number): boolean =>
  estimateToolTokens(tools) <= toolTokenLimit(contextWindow);

const withinRoutedLimits = (tools: McpTool[], contextWindow: number): boolean =>
  withinToolTokenBudget(tools, contextWindow) && tools.length <= MAX_ROUTED_TOOL_OPTIONS;

const fitToolsToLimits = (tools: McpTool[], maxToolCount: number, contextWindow: number): McpTool[] => {
  const kept: McpTool[] = [];
  for (const tool of tools) {
    const next = [...kept, tool];
    if (next.length > maxToolCount) break;
    if (estimateToolTokens(next) > toolTokenLimit(contextWindow)) break;
    kept.push(tool);
  }
  if (kept.length > 0) return kept;
  return tools.slice(0, 1);
};

type ToolSelection = { toolNames: string[] };

const toolSelectionSchema = (maxTools: number) => jsonSchema<ToolSelection>({
  type: 'object',
  properties: {
    toolNames: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: maxTools,
      description: 'Exact MCP tool keys (server/name) needed for the next step, most relevant first',
    },
  },
  required: ['toolNames'],
});

const jsonPromptSuffix = (maxTools: number) => `

Return only a single JSON object (no markdown fences or surrounding prose) with:
- toolNames: string[] (1–${maxTools} exact tool keys from the catalog, most relevant first)`;

const normalizeSelectedToolNames = (
  raw: unknown,
  validKeys: Set<string>,
  maxTools: number,
): string[] => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.toolNames)) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of record.toolNames) {
    if (typeof entry !== 'string') continue;
    const key = entry.trim();
    if (!key || !validKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    names.push(key);
    if (names.length >= maxTools) break;
  }
  return names;
};

const parseToolSelectionJson = (text: string, validKeys: Set<string>, maxTools: number): string[] => {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new Error('Could not parse tool selection JSON');
  }

  return normalizeSelectedToolNames(parsed, validKeys, maxTools);
};

const selectToolNamesWithLlm = async (
  messages: Fl0wMessage[],
  tools: McpTool[],
  maxToolCount: number,
  contextWindow: number,
  model: string
): Promise<string[]> => {
  const validKeys = new Set(tools.map(mcpToolKey));
  const catalog = tools.map(toolToText).join('\n');
  const messagesJson = JSON.stringify(toModelMessages(messages));

  const instructions = `
Given the conversation and the full tool catalog below, return only the tool keys that are likely needed for the user's last task. Prefer fewer tools when possible. Use exact keys from the catalog (server/name format).

Select at most ${maxToolCount} tools.

Conversation (JSON messages):
${messagesJson}

Tool catalog:
${catalog}`;

  const runStructured = () => retryModelCall(() => generateText({
    model: model,
    prompt: instructions,
    output: Output.object({
      schema: toolSelectionSchema(maxToolCount),
      name: 'ToolSelection',
      description: 'MCP tool keys relevant for the next agent step',
    }),
  }));

  try {
    const generation = await runStructured();
    sessionUsageStore.record(generation);
    return normalizeSelectedToolNames(generation.output, validKeys, maxToolCount);
  } catch { }

  const generation = await retryModelCall(() => generateText({
    model: model,
    prompt: instructions + jsonPromptSuffix(maxToolCount),
  }));
  sessionUsageStore.record(generation);
  return parseToolSelectionJson(generation.text, validKeys, maxToolCount);
};

const orderToolsByKeys = (tools: McpTool[], keys: string[]): McpTool[] => {
  const byKey = new Map(tools.map((tool) => [mcpToolKey(tool), tool]));
  return keys.map((key) => byKey.get(key)).filter((tool): tool is McpTool => tool !== undefined);
};

const catalogKey = (tools: McpTool[]): string => tools.map(mcpToolKey).join('\0');

const lastUserMessageIndex = (messages: Fl0wMessage[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.message.role === 'user') return i;
  }
  return -1;
};

type ToolRouteCache = {
  catalogKey: string;
  userTurnIndex: number;
  toolKeys: string[];
};

let toolRouteCache: ToolRouteCache | undefined;

export const clearToolRouteCache = (): void => {
  toolRouteCache = undefined;
};

export const reduceTools = async (
  messages: Fl0wMessage[],
  tools: McpTool[],
  contextWindow: number,
  model: string
): Promise<McpTool[]> => {
  if (tools.length === 0) return tools;
  if (withinToolTokenBudget(tools, contextWindow)) return tools;

  const key = catalogKey(tools);
  const userTurnIndex = lastUserMessageIndex(messages);
  if (
    toolRouteCache?.catalogKey === key
    && toolRouteCache.userTurnIndex === userTurnIndex
    && toolRouteCache.toolKeys.length > 0
  ) {
    let cached = orderToolsByKeys(tools, toolRouteCache.toolKeys);
    if (!withinRoutedLimits(cached, contextWindow)) cached = fitToolsToLimits(cached, MAX_ROUTED_TOOL_OPTIONS, contextWindow);
    if (withinRoutedLimits(cached, contextWindow)) return cached;
  }

  let selectedKeys: string[] = [];
  try {
    selectedKeys = await selectToolNamesWithLlm(messages, tools, MAX_ROUTED_TOOL_OPTIONS, contextWindow, model);
  } catch {
    selectedKeys = [];
  }

  let reduced = selectedKeys.length > 0
    ? orderToolsByKeys(tools, selectedKeys)
    : fitToolsToLimits(tools, MAX_ROUTED_TOOL_OPTIONS, contextWindow);

  if (!withinRoutedLimits(reduced, contextWindow)) {
    reduced = fitToolsToLimits(reduced, MAX_ROUTED_TOOL_OPTIONS, contextWindow);
  }

  if (!withinRoutedLimits(reduced, contextWindow)) {
    const tokens = estimateToolTokens(reduced);
    throw new Error(
      `Could not reduce enabled tools for routing (estimated ${tokens} tokens, limit ${toolTokenLimit(contextWindow)}). Try disabling some MCP servers or capabilities.`,
    );
  }

  toolRouteCache = { catalogKey: key, userTurnIndex, toolKeys: reduced.map(mcpToolKey) };
  return reduced;
};
