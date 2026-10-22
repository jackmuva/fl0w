import {
  CONTEXT_WINDOW,
  LLM_MODEL,
  MAX_ROUTED_TOOL_OPTIONS,
  TOOL_TOKEN_THRESHOLD,
} from '../../../constants';
import type { AgentState } from '../../../models/agent';
import { mcpToolKey, type McpTool } from '../../../models/mcp';
import { retryModelCall } from '../../utils';
import { toModelMessages } from '../utils/fl0w-message';
import { estimateTextTokens } from './compaction';
import { recordLlmUsage } from './session-usage';
import {
  generateText,
  jsonSchema,
  Output,
} from 'ai';

const toolTokenLimit = (): number => Math.floor(CONTEXT_WINDOW * TOOL_TOKEN_THRESHOLD);

const toolToText = (tool: McpTool): string => {
  const payload = {
    description: tool.description ?? 'No description provided',
    inputSchema: tool.inputSchema,
  };
  return `${mcpToolKey(tool)}: ${JSON.stringify(payload)}`;
};

const estimateToolTokens = (tools: McpTool[]): number =>
  tools.reduce((total, tool) => total + estimateTextTokens(toolToText(tool)), 0);

const toolsWithinLimits = (tools: McpTool[], maxToolCount: number): boolean =>
  estimateToolTokens(tools) <= toolTokenLimit() && tools.length <= maxToolCount;

const fitToolsToLimits = (tools: McpTool[], maxToolCount: number): McpTool[] => {
  const kept: McpTool[] = [];
  for (const tool of tools) {
    const next = [...kept, tool];
    if (next.length > maxToolCount) break;
    if (estimateToolTokens(next) > toolTokenLimit()) break;
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
  state: AgentState,
  tools: McpTool[],
  maxToolCount: number,
): Promise<string[]> => {
  const validKeys = new Set(tools.map(mcpToolKey));
  const catalog = tools.map(toolToText).join('\n');
  const messagesJson = JSON.stringify(toModelMessages(state.messages));

  const instructions = `You route an agent by choosing which MCP tools should be available for the next decision step.

Given the conversation and the full tool catalog below, return only the tool keys that are likely needed for the immediate next step. Prefer fewer tools when possible. Use exact keys from the catalog (server/name format).

Select at most ${maxToolCount} tools.

Conversation (JSON messages):
${messagesJson}

Tool catalog:
${catalog}`;

  const runStructured = () => retryModelCall(() => generateText({
    model: LLM_MODEL,
    prompt: instructions,
    output: Output.object({
      schema: toolSelectionSchema(maxToolCount),
      name: 'ToolSelection',
      description: 'MCP tool keys relevant for the next agent step',
    }),
  }));

  try {
    const generation = await runStructured();
    recordLlmUsage(generation);
    return normalizeSelectedToolNames(generation.output, validKeys, maxToolCount);
  } catch { }

  const generation = await retryModelCall(() => generateText({
    model: LLM_MODEL,
    prompt: instructions + jsonPromptSuffix(maxToolCount),
  }));
  recordLlmUsage(generation);
  return parseToolSelectionJson(generation.text, validKeys, maxToolCount);
};

const orderToolsByKeys = (tools: McpTool[], keys: string[]): McpTool[] => {
  const byKey = new Map(tools.map((tool) => [mcpToolKey(tool), tool]));
  return keys.map((key) => byKey.get(key)).filter((tool): tool is McpTool => tool !== undefined);
};

export const reduceTools = async (
  state: AgentState,
  tools: McpTool[],
  maxToolCount = MAX_ROUTED_TOOL_OPTIONS,
): Promise<McpTool[]> => {
  if (tools.length === 0) return tools;
  if (toolsWithinLimits(tools, maxToolCount)) return tools;

  let selectedKeys: string[] = [];
  try {
    selectedKeys = await selectToolNamesWithLlm(state, tools, maxToolCount);
  } catch {
    selectedKeys = [];
  }

  let reduced = selectedKeys.length > 0
    ? orderToolsByKeys(tools, selectedKeys)
    : fitToolsToLimits(tools, maxToolCount);

  if (!toolsWithinLimits(reduced, maxToolCount)) {
    reduced = fitToolsToLimits(reduced, maxToolCount);
  }

  if (!toolsWithinLimits(reduced, maxToolCount)) {
    const tokens = estimateToolTokens(reduced);
    throw new Error(
      `Could not reduce enabled tools for routing (estimated ${tokens} tokens, limit ${toolTokenLimit()}). Try disabling some MCP servers or capabilities.`,
    );
  }

  return reduced;
};
