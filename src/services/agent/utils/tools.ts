import { jsonSchema, tool, type generateText, type JSONValue } from "ai";
import { mcpToolKey, type McpTool, type McpToolResult } from "../../../models/mcp";
import { HEADLESS, sessionWorkspacePath, TOOL_OUTPUT_MAX_CHARS } from "../../../constants";
import { mcpClient } from "../../mcp/mcp-client";
import { isCapabilityEnabled, isMcpToolEnabled } from "../capabilities";
import { executeDefaultTool, getDefaultTool, isDefaultToolKey, listDefaultTools } from "../default-tools";
import { DEFAULT_ASK_QUESTION_TOOL, DEFAULT_CREATE_PLAN_TOOL, defaultToolKey } from "../default-tools/utils";
import { listSkills } from "../hooks/front-load";
import { executeUserTool, isUserToolKey, listUserTools } from "../user-tools/loader";
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolOutputFileNotice } from "../default-tools/read-full-tool-output";

export const CREATE_PLAN_ACTION = DEFAULT_CREATE_PLAN_TOOL;
export const ASK_QUESTION_ACTION = DEFAULT_ASK_QUESTION_TOOL;
export type EvaluateMcpTool = Pick<McpTool, 'server' | 'name' | 'description' | 'inputSchema'>;

export const parseToolKey = (key: string): { server: string, name: string } => {
  const slash = key.indexOf('/');
  return { server: key.slice(0, slash), name: key.slice(slash + 1) };
};

const toolCallGenerationErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const describeToolCallGenerationFailure = (
  toolCalls: Awaited<ReturnType<typeof generateText>>['toolCalls'],
  toolName: string,
): string | undefined => {
  const invalidMatch = toolCalls.find((call) => call.toolName === toolName && call.invalid);
  if (invalidMatch?.error) return toolCallGenerationErrorMessage(invalidMatch.error);

  const wrongTool = toolCalls.find((call) => !call.invalid && call.toolName !== toolName);
  if (wrongTool) return `Model called "${wrongTool.toolName}" instead of "${toolName}".`;

  const anyInvalid = toolCalls.find((call) => call.invalid);
  if (anyInvalid?.error) return toolCallGenerationErrorMessage(anyInvalid.error);

  if (toolCalls.length === 0) return 'Model returned no tool call.';
  return undefined;
};

export const buildToolCriteria = (tools: McpTool[], onlyTools: boolean = false) => {
  let criteria: {
    [action: string]: {
      description: string,
      inputSchema?: JSONValue,
    }
  } = Object.fromEntries(tools.map((t) => [mcpToolKey(t), {
    description: t.description ?? 'No description provided',
    inputSchema: t.inputSchema as JSONValue,
  }]));
  if (onlyTools) return criteria;
  criteria = {
    ...criteria,
    taskCompleted: {
      description: "The user's task was completed"
    },
    wrongPath: {
      description: "Based off the given tools, we took the wrong steps. Rewind to the last message"
    },
    notPossible: {
      description: "Based off the given tools, the task is not possible"
    },
  }
  return criteria;
}

export const toolsForEvaluateState = (tools: McpTool[]): EvaluateMcpTool[] =>
  tools.map(({ server, name, description, inputSchema }) => ({
    server,
    name,
    description,
    inputSchema,
  }));

export const formatToolList = (tools: McpTool[]) => tools
  .map((entry) => `- ${entry.server}/${entry.name}${entry.description ? `: ${entry.description}` : ''}`)
  .join('\n');

export const listAllTools = async () => [
  ...listDefaultTools().filter((entry) => {
    if (entry.name === 'load_skill' && listSkills().length === 0) return false;
    if (HEADLESS && entry.name === 'ask_question') return false;
    return true;
  }),
  ...listUserTools().filter((entry) => isCapabilityEnabled('userTools', entry.name)),
  ...(await mcpClient.listTools()).filter((entry) => isMcpToolEnabled(entry)),
];

export const toAiSdkTools = (tools: McpTool[]) =>
  Object.fromEntries(tools.map((entry) => {
    const key = mcpToolKey(entry);
    const defaultEntry = entry.server === 'default' ? getDefaultTool(entry.name) : undefined;
    if (defaultEntry?.tool) return [key, defaultEntry.tool];
    return [key, tool({
      description: entry.description ?? `Call the ${key} tool`,
      inputSchema: jsonSchema<Record<string, unknown>>(entry.inputSchema as Record<string, unknown>),
    })];
  }));

export const READ_FULL_TOOL_OUTPUT_TOOL = defaultToolKey('read_full_tool_output');

const UNCAPPED_TOOLS = new Set([READ_FULL_TOOL_OUTPUT_TOOL, defaultToolKey('message_answer'), CREATE_PLAN_ACTION]);

export type ToolCallContext = {
  toolCallId: string;
  sessionId?: string;
};

export const capToolOutput = async (
  result: McpToolResult,
  toolCallId: string,
  sessionId?: string,
): Promise<McpToolResult> => {
  const max = TOOL_OUTPUT_MAX_CHARS;
  if (result.content.length <= max) return result;

  const preview = result.content.slice(0, max);
  const header = `[Output truncated: showing first ${max} of ${result.content.length} chars.`;
  if (!sessionId) return { ...result, content: `${header} Full output was not saved (no session).]\n${preview}` };

  const safeName = `${result.server}_${result.tool}-${toolCallId}`.replace(/[^\w.-]/g, '_');
  const path = join(sessionWorkspacePath(sessionId), `${safeName}.txt`);
  try {
    await mkdir(sessionWorkspacePath(sessionId), { recursive: true });
    await writeFile(path, result.content, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...result, content: `${header} Full output could not be saved: ${reason}]\n${preview}` };
  }
  return { ...result, content: `${header} ${toolOutputFileNotice(path)}.]\n${preview}` };
};

export const executeNamedTool = async (
  toolName: string,
  input: Record<string, unknown>,
  context?: ToolCallContext,
): Promise<McpToolResult> => {
  const { server, name } = parseToolKey(toolName);
  const result = isDefaultToolKey(toolName)
    ? await executeDefaultTool(name, input)
    : isUserToolKey(toolName)
      ? await executeUserTool(name, input)
      : await mcpClient.callTool(server, name, input);
  if (!context || UNCAPPED_TOOLS.has(toolName)) return result;
  return capToolOutput(result, context.toolCallId, context.sessionId);
};


