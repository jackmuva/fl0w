import { jsonSchema, tool, type generateText, type JSONValue } from "ai";
import { mcpToolKey, type McpTool, type McpToolResult } from "../../../models/mcp";
import { HEADLESS } from "../../../constants";
import { mcpClient } from "../../mcp/mcp-client";
import { isCapabilityEnabled, isMcpToolEnabled } from "../capabilities";
import { executeDefaultTool, isDefaultToolKey, listDefaultTools } from "../default-tools";
import { listSkills } from "../hooks/front-load";
import { executeUserTool, isUserToolKey, listUserTools } from "../user-tools/loader";

export const CREATE_PLAN_ACTION = 'CreatePlan';
export const ASK_QUESTION_ACTION = 'AskQuestion';
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
    [CREATE_PLAN_ACTION]: {
      description: 'Create or revise a numbered plan based on progress and new information.',
    },
    // headless runs have nobody to answer, so never offer follow-up questions
    ...(!HEADLESS && {
      [ASK_QUESTION_ACTION]: {
        description: 'Ask follow-up questions when the task needs more clarity.',
      },
    }),
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
  // load_skill is useless when every skill is disabled
  ...listDefaultTools().filter((entry) => entry.name !== 'load_skill' || listSkills().length > 0),
  ...listUserTools().filter((entry) => isCapabilityEnabled('userTools', entry.name)),
  ...(await mcpClient.listTools()).filter((entry) => isMcpToolEnabled(entry)),
];

export const toAiSdkTools = (tools: McpTool[]) =>
  Object.fromEntries(tools.map((entry) => {
    const key = mcpToolKey(entry);
    return [key, tool({
      description: entry.description ?? `Call the ${key} tool`,
      inputSchema: jsonSchema<Record<string, unknown>>(entry.inputSchema as Record<string, unknown>),
    })];
  }));

export const executeNamedTool = async (
  toolName: string,
  input: Record<string, unknown>,
): Promise<McpToolResult> => {
  const { server, name } = parseToolKey(toolName);
  if (isDefaultToolKey(toolName)) return executeDefaultTool(name, input);
  if (isUserToolKey(toolName)) return executeUserTool(name, input);
  return mcpClient.callTool(server, name, input);
};


