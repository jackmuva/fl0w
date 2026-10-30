import { jsonSchema, tool, type generateText } from "ai";
import { mcpToolKey, type McpTool, type McpToolResult } from "../../../models/mcp";
import { sessionWorkspacePath, TOOL_OUTPUT_MAX_CHARS, USER_TOOL_SERVER, WORKFLOW_RUN } from "../../../constants";
import { mcpClient } from "../../external-tools/mcp-client";
import { isCapabilityEnabled, isMcpToolEnabled } from "../../capabilities";
import { executeDefaultTool, getDefaultTool, listDefaultTools } from "../default-tools";
import { DEFAULT_ASK_QUESTION_TOOL, DEFAULT_CREATE_PLAN_TOOL, DEFAULT_TOOL_SERVER, defaultToolKey, READ_FULL_TOOL_OUTPUT_TOOL } from "../default-tools/tool-utils";
import { skillService } from "../../external-tools/skill-service";
import { userToolLoader } from "../../external-tools/user-tool-service";
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolOutputFileNotice } from "../default-tools/read-full-tool-output";

export const CREATE_PLAN_ACTION = DEFAULT_CREATE_PLAN_TOOL;
export const ASK_QUESTION_ACTION = DEFAULT_ASK_QUESTION_TOOL;
export type EvaluateMcpTool = Pick<McpTool, 'server' | 'name' | 'description' | 'inputSchema'>;

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

/** `unattended` (default: a `fl0w workflow` run) withholds ask_question, since nobody is there to answer it. */
export const listAllTools = async (unattended = WORKFLOW_RUN) => [
  ...listDefaultTools().filter((entry) => {
    if (entry.name === 'load_skill' && skillService.listSkills().length === 0) return false;
    if (unattended && entry.name === 'ask_question') return false;
    return true;
  }),
  ...userToolLoader.listUserTools().filter((entry) => isCapabilityEnabled('userTools', entry.name)),
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
      execute: async (input, { toolCallId }) => {
        const result = await executeTool(entry, input, { toolCallId });
        if (result.isError) throw new Error(result.content);
        return result.content;
      },
    })];
  }));

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

export const executeTool = async (
  { server, name }: Pick<McpTool, 'server' | 'name'>,
  input: Record<string, unknown>,
  context?: ToolCallContext,
): Promise<McpToolResult> => {
  const result = server === DEFAULT_TOOL_SERVER
    ? await executeDefaultTool(name, input)
    : server === USER_TOOL_SERVER
      ? await userToolLoader.executeUserTool(name, input)
      : await mcpClient.callTool(server, name, input);
  if (!context || UNCAPPED_TOOLS.has(mcpToolKey({ server, name }))) return result;
  return capToolOutput(result, context.toolCallId, context.sessionId);
};


