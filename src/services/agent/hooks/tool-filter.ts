import {
  CONTEXT_WINDOW,
  MAX_EVALUATE_TOOL_OPTIONS,
  DECISION_MODEL,
  TOOL_REDUCE_MAX_ITERATIONS,
  TOOL_TOKEN_THRESHOLD,
} from '../../../constants';
import type { AgentState } from '../../../models/agent';
import { mcpToolKey, type McpTool } from '../../../models/mcp';
import { retryModelCall } from '../../utils';
import { toModelMessages } from '../utils/fl0w-message';
import { buildToolCriteria } from '../utils/tools';
import { estimateTextTokens } from './compaction';
import { recordLlmUsage } from './session-usage';
import { experimental_evaluate as evaluate, type JSONValue } from 'ai';

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

const chunkToolsByTokenLimit = (
  tools: McpTool[],
  maxToolsPerChunk = MAX_EVALUATE_TOOL_OPTIONS,
): McpTool[][] => {
  const chunks: McpTool[][] = [];
  let cur: McpTool[] = [];
  for (const tool of tools) {
    if (estimateToolTokens([tool]) > toolTokenLimit()) {
      if (cur.length > 0) {
        chunks.push(cur);
        cur = [];
      }
      chunks.push([tool]);
      continue;
    }
    const next = [...cur, tool];
    if (next.length > maxToolsPerChunk || estimateToolTokens(next) > toolTokenLimit()) {
      if (cur.length > 0) chunks.push(cur);
      cur = [tool];
    } else {
      cur = next;
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
};

const rankToolsInChunk = async (state: AgentState, chunk: McpTool[]): Promise<McpTool[]> => {
  const chunkKeys = new Set(chunk.map(mcpToolKey));
  const runEvaluate = () => retryModelCall(() => evaluate({
    model: DECISION_MODEL,
    state: [{
      messages: toModelMessages(state.messages) as JSONValue,
    }],
    questions: {
      selectedAction: {
        type: 'choice',
        instructions: 'Which action should we call next?',
        criteria: buildToolCriteria(chunk, true),
      },
    },
  }));

  let actionEvaluation;
  try {
    actionEvaluation = await runEvaluate();
  } catch {
    try {
      actionEvaluation = await runEvaluate();
    } catch {
      if (chunk.length <= 1) return chunk;
      return chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2)));
    }
  }
  recordLlmUsage(actionEvaluation);

  const { answers } = actionEvaluation;
  const threshold = 1 / (chunk.length * 2);
  const probabilities = answers.selectedAction.probabilities ?? { [answers.selectedAction.choice]: 1 };
  let rankedKeys = Object.entries(probabilities)
    .filter(([key]) => chunkKeys.has(key))
    .filter(([, probability]) => probability > threshold)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => key);

  if (rankedKeys.length === 0) {
    rankedKeys = Object.entries(probabilities)
      .filter(([key]) => chunkKeys.has(key))
      .sort(([, a], [, b]) => b - a)
      .map(([key]) => key);
    if (rankedKeys.length === 0) return chunk;
  }

  const keep = new Set(rankedKeys);
  let kept = chunk.filter((tool) => keep.has(mcpToolKey(tool)));
  if (kept.length === chunk.length && chunk.length > 1) {
    const halfKeys = new Set(
      rankedKeys.slice(0, Math.max(1, Math.floor(chunk.length / 2))),
    );
    kept = chunk.filter((tool) => halfKeys.has(mcpToolKey(tool)));
  }
  return kept;
};

const toolsWithinLimits = (tools: McpTool[], maxToolCount: number): boolean =>
  estimateToolTokens(tools) <= toolTokenLimit() && tools.length <= maxToolCount;

export const reduceTools = async (
  state: AgentState,
  tools: McpTool[],
  iteration = 0,
  maxToolCount = MAX_EVALUATE_TOOL_OPTIONS,
): Promise<McpTool[]> => {
  const tokens = estimateToolTokens(tools);
  if (toolsWithinLimits(tools, maxToolCount)) return tools;
  if (iteration >= TOOL_REDUCE_MAX_ITERATIONS) {
    const parts = [
      `estimated ${tokens} tokens (limit ${toolTokenLimit()})`,
      tools.length > maxToolCount ? `${tools.length} tools (limit ${maxToolCount})` : null,
    ].filter(Boolean).join(', ');
    throw new Error(
      `Could not reduce enabled tools for System One routing (${parts}) after ${TOOL_REDUCE_MAX_ITERATIONS} filtering attempts. Try disabling some MCP servers or capabilities.`,
    );
  }

  const toolChunks = chunkToolsByTokenLimit(tools);
  const filteredChunks = await Promise.allSettled(
    toolChunks.map((chunk) => rankToolsInChunk(state, chunk)),
  );
  let filteredTools = filteredChunks.flatMap((result, i) =>
    result.status === 'fulfilled' ? result.value : toolChunks[i]!,
  );

  if (filteredTools.length === tools.length && tools.length > 1) {
    filteredTools = tools.slice(0, Math.max(1, Math.floor(tools.length / 2)));
  }

  return reduceTools(state, filteredTools, iteration + 1, maxToolCount);
};
