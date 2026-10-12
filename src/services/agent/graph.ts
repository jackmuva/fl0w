import {
  experimental_evaluate as evaluate,
  generateText,
  jsonSchema,
  tool,
  ToolChoiceViolationError,
  type JSONValue,
  type ModelMessage,
  type ToolChoice,
} from 'ai';
import { compactMessages } from './hooks/compaction';
import { HEADLESS, LLM_MODEL, SYSTEM_ONE_MODEL } from '../../constants';
import { recordLlmUsage } from './hooks/session-usage';
import type { AgentState, JevMessage } from '../../models/agent';
import { mcpToolKey, type McpTool } from '../../models/mcp';
import { mcpClient } from '../mcp/mcp-client';
import { isCapabilityEnabled, isMcpToolEnabled } from './capabilities';
import { askQuestionTool, type AskQuestionInput } from './default-tools/ask-question';
import { createPlanTool, type CreatePlanInput, wrapPlanToolMessages } from './default-tools/create-plan';
import {
  executeDefaultTool,
  isDefaultToolKey,
  listDefaultTools,
} from './default-tools';
import { listSkills } from './hooks/front-load';
import { preparePrompt } from './prompt';
import { executeUserTool, isUserToolKey, listUserTools, loadUserTools } from './user-tools/loader';
import { jevMessage, toModelMessages } from './utils/jev-message';
import { retryModelCall } from '../utils';

const parseToolKey = (key: string): { server: string, name: string } => {
  const slash = key.indexOf('/');
  return { server: key.slice(0, slash), name: key.slice(slash + 1) };
};

const toolCallGenerationErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeToolCallGenerationFailure = (
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

const generateRequiredToolCall = async ({
  instructions,
  messages,
  tools,
  toolName,
  maxAttempts = 3,
  forceRequired = true,
}: {
  instructions: string;
  messages: JevMessage[];
  tools: Record<string, any>;
  toolName: string;
  maxAttempts?: number;
  forceRequired?: boolean;
}): Promise<{ toolCall?: Awaited<ReturnType<typeof generateText>>['toolCalls'][number], failureReason?: string }> => {
  let failureReason: string | undefined;

  const pinnedToolChoice = { type: 'tool' as const, toolName: toolName as Extract<keyof typeof tools, string> };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const toolChoice: ToolChoice<typeof tools> = Object.keys(tools).length === 1
      ? pinnedToolChoice
      : forceRequired || attempt >= maxAttempts - 1
        ? 'required'
        : pinnedToolChoice;

    try {
      const prompt = preparePrompt(instructions, messages);
      const result = await retryModelCall(() => generateText({
        model: LLM_MODEL,
        instructions: prompt.instructions,
        messages: prompt.messages,
        tools,
        toolChoice,
      }));
      recordLlmUsage(result);

      const toolCall = result.toolCalls.find((call) => !call.invalid && call.toolName === toolName);
      if (toolCall) return { toolCall };

      failureReason = describeToolCallGenerationFailure(result.toolCalls, toolName) ?? failureReason;
    } catch (error) {
      if (!ToolChoiceViolationError.isInstance(error)) throw error;
      failureReason = error.message;
    }
  }

  return { failureReason };
};

const CREATE_PLAN_ACTION = 'CreatePlan';
const ASK_QUESTION_ACTION = 'AskQuestion';

type EvaluateMcpTool = Pick<McpTool, 'server' | 'name' | 'description' | 'inputSchema'>;

const toolsForEvaluateState = (tools: McpTool[]): EvaluateMcpTool[] =>
  tools.map(({ server, name, description, inputSchema }) => ({
    server,
    name,
    description,
    inputSchema,
  }));

const buildToolCriteria = (tools: McpTool[]) => {
  let criteria: {
    [action: string]: {
      description: string,
      inputSchema?: JSONValue,
    }
  } = Object.fromEntries(tools.map((t) => [mcpToolKey(t), {
    description: t.description ?? 'No description provided',
    inputSchema: t.inputSchema as JSONValue,
  }]));

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

await loadUserTools();

const listAllTools = async () => [
  // load_skill is useless when every skill is disabled
  ...listDefaultTools().filter((t) => t.name !== 'load_skill' || listSkills().length > 0),
  ...listUserTools().filter((t) => isCapabilityEnabled('userTools', t.name)),
  ...(await mcpClient.listTools()).filter((t) => isMcpToolEnabled(t)),
];

const formatToolList = (tools: McpTool[]) => tools
  .map((tool) => `- ${tool.server}/${tool.name}${tool.description ? `: ${tool.description}` : ''}`)
  .join('\n');

export const initialNode = async (state: AgentState): Promise<AgentState> => {
  const tools = await listAllTools();
  const initialEvaluation = await retryModelCall(() => evaluate({
    model: SYSTEM_ONE_MODEL,
    state: [{
      toolsAvailable: toolsForEvaluateState(tools) as JSONValue,
      messages: toModelMessages(state.messages) as JSONValue,
    }],
    questions: {
      nextStep: {
        type: "choice",
        instructions: "Based off the user's last ask and the tools given, what should we do?",
        criteria: {
          "directAnswer": "The user wants a command or action performed with a single tool call.",
          "createPlan": "The user's task is a multi-step problem. We should create a plan.",
          ...(!HEADLESS && { "clarifyTask": "The task is too ambiguous. We should ask followup questions." }),
          "outOfScope": "The task is outside of the capabilities given the tools"
        }
      }
    },
  }));
  recordLlmUsage(initialEvaluation);

  const { answers } = initialEvaluation;
  const probabilities = answers.nextStep.probabilities;

  if (answers.nextStep.choice === "outOfScope") {
    const message: ModelMessage = {
      role: 'assistant',
      content: "task out of scope"
    };
    return { state: "END", messages: [...state.messages, jevMessage(message)] };
  } else if (answers.nextStep.choice === "createPlan") {
    return { state: "PLAN", messages: state.messages, probabilities };
  } else if (answers.nextStep.choice === "directAnswer") {
    return { state: "EXECUTE", messages: state.messages };
  } else {
    return { state: "DISCOVERY", messages: state.messages, probabilities };
  }
}

export const actionSelectNode = async (
  state: AgentState,
): Promise<{ state: AgentState, options: string[] }> => {
  const availableTools = await listAllTools();
  const criteria = buildToolCriteria(availableTools);

  const actionEvaluation = await retryModelCall(() => evaluate({
    model: SYSTEM_ONE_MODEL,
    state: [{
      messages: toModelMessages(state.messages) as JSONValue,
    }],
    questions: {
      selectedAction: {
        type: 'choice',
        instructions: 'Which action should we call next?',
        criteria,
      },
    },
  }));
  recordLlmUsage(actionEvaluation);

  const { answers } = actionEvaluation;
  const threshold = 1 / (availableTools.length * 2);
  const probabilities = answers.selectedAction.probabilities ?? { [answers.selectedAction.choice]: 1 };
  const options = Object.entries(probabilities).filter(([, probability]) => probability > threshold)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => key);

  const selectedAction = options[0] ?? answers.selectedAction.choice;

  if (answers.selectedAction.choice === "taskCompleted") {
    const message: ModelMessage = {
      role: "assistant",
      content: "Task Complete",
    };
    return {
      state: {
        state: "END", messages: [...state.messages, jevMessage(message)],
      },
      options: [],
    };
  } else if (answers.selectedAction.choice === "wrongPath") {
    const message: ModelMessage = {
      role: "assistant",
      content: "Rewinding to last choice",
    };
    return {
      state: {
        state: "REWIND", messages: [...state.messages, jevMessage(message)],
      },
      options,
    };
  } else if (answers.selectedAction.choice === "notPossible") {
    const message: ModelMessage = {
      role: "assistant",
      content: "Unable to complete the task with given tools",
    };
    return {
      state: { state: "END", messages: [...state.messages, jevMessage(message)] },
      options: [],
    };
  }
  return {
    state: {
      state: 'EXECUTE',
      messages: state.messages,
      selectedTool: selectedAction,
      probabilities,
    },
    options,
  };
}

export const createPlanNode = async (state: AgentState): Promise<AgentState> => {
  const toolList = formatToolList(await listAllTools());
  const planInstructions = `You are a planner. Break the user's task into a short numbered list of steps.
If a plan already exists, revise it to reflect new information.

We have the following tools to complete the task:
${toolList || '(none)'}

Do not execute any steps or call any of the tools above yet; only call the CreatePlan tool with the plan as a markdown numbered list.`;

  let { toolCall } = await generateRequiredToolCall({
    instructions: planInstructions,
    messages: state.messages,
    tools: { CreatePlan: createPlanTool },
    toolName: CREATE_PLAN_ACTION,
    maxAttempts: 1,
    forceRequired: true,
  });

  if (!toolCall) {
    ({ toolCall } = await generateRequiredToolCall({
      instructions: planInstructions,
      messages: state.messages,
      tools: { CreatePlan: createPlanTool },
      toolName: CREATE_PLAN_ACTION,
    }));
  }

  if (!toolCall) {
    const message: ModelMessage = {
      role: 'assistant',
      content: 'Could not create a plan for this task.',
    };
    return { state: 'EXECUTE', messages: [...state.messages, jevMessage(message)] };
  }

  const input = toolCall.input as CreatePlanInput;
  const [toolCallMessage, toolResultMessage] = wrapPlanToolMessages(input.plan, toolCall.toolCallId);

  return {
    state: 'EXECUTE',
    messages: [
      ...state.messages,
      jevMessage(toolCallMessage, state.probabilities),
      jevMessage(toolResultMessage),
    ],
  };
};

export const clarifyTaskNode = async (state: AgentState): Promise<AgentState> => {
  const { toolCall } = await generateRequiredToolCall({
    instructions: `You are helping clarify an ambiguous user task. Ask 1-3 focused follow-up questions to resolve what is unclear.


Call the AskQuestion tool with concrete options for each question. Provide 2-4 likely answers per question based on the task and available tools. Always include an option with id "other" and label "Other" so the user can type a custom answer.`,
    messages: state.messages,
    tools: { AskQuestion: askQuestionTool },
    toolName: ASK_QUESTION_ACTION,
  });

  if (!toolCall) {
    const message: ModelMessage = {
      role: 'assistant',
      content: 'I need a bit more detail to proceed. Could you clarify your request?',
    };
    return { state: 'DISCOVERY', messages: [...state.messages, jevMessage(message)] };
  }

  const input = toolCall.input as AskQuestionInput;
  const message: ModelMessage = {
    role: 'assistant',
    content: [{
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: ASK_QUESTION_ACTION,
      input,
    }],
  };

  return {
    state: 'DISCOVERY',
    messages: [...state.messages, jevMessage(message, state.probabilities)],
  };
};

export const runToolNode = async (state: AgentState): Promise<AgentState> => {
  const selectedTool = state.selectedTool;
  if (!selectedTool) {
    const message: ModelMessage = {
      role: 'assistant',
      content: 'No tool selected to run.',
    };
    return { state: 'END', messages: [...state.messages, jevMessage(message)] };
  }

  if (selectedTool === CREATE_PLAN_ACTION) {
    return createPlanNode(state);
  }

  if (selectedTool === ASK_QUESTION_ACTION) {
    return clarifyTaskNode(state);
  }

  const availableTools = await listAllTools();
  const selected = availableTools.find((t) => mcpToolKey(t) === selectedTool);
  if (!selected) {
    const message: ModelMessage = {
      role: 'assistant',
      content: `Unknown tool: ${selectedTool}`,
    };
    return { state: 'END', messages: [...state.messages, jevMessage(message)] };
  }

  const { server, name } = parseToolKey(selectedTool);
  const aiTool = tool({
    description: selected.description ?? `Call the ${selectedTool} tool`,
    inputSchema: jsonSchema<Record<string, unknown>>(selected.inputSchema as Record<string, unknown>),
  });

  const instructions = name === 'message_answer'
    ? `The user asked a question. Call the ${selectedTool} tool with a clear, helpful answer based on the conversation and your knowledge.`
    : `Call the ${selectedTool} tool with the arguments needed to make progress on the user's task.`;

  const { toolCall, failureReason } = await generateRequiredToolCall({
    instructions,
    messages: state.messages,
    tools: { [selectedTool]: aiTool },
    toolName: selectedTool,
  });

  if (!toolCall) {
    const detail = failureReason ? `: ${failureReason}` : '.';
    const message: ModelMessage = {
      role: 'assistant',
      content: `Could not determine arguments for ${selectedTool}${detail}`,
    };
    return { ...state, state: 'EXECUTE', messages: [...state.messages, jevMessage(message)] };
  }

  const toolCallMessage: ModelMessage = {
    role: 'assistant',
    content: [{
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: selectedTool,
      input: toolCall.input,
    }],
  };

  const toolResult = isDefaultToolKey(selectedTool)
    ? await executeDefaultTool(name, toolCall.input as Record<string, unknown>)
    : isUserToolKey(selectedTool)
      ? await executeUserTool(name, toolCall.input as Record<string, unknown>)
      : await mcpClient.callTool(server, name, toolCall.input as Record<string, unknown>);
  const toolResultMessage = mcpClient.toMessage(toolCall.toolCallId, toolResult);

  let messages: JevMessage[] = [
    ...state.messages,
    jevMessage(toolCallMessage, state.probabilities),
    jevMessage(toolResultMessage),
  ];
  messages = await compactMessages(messages);

  return {
    state: 'EXECUTE',
    messages,
    selectedTool,
    probabilities: state.probabilities,
  };
}
