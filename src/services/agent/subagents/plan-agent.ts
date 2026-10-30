import { isStepCount, streamText, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import { retryModelCall } from "../../service-utils";
import { frontLoadInstructions } from "../hooks/front-load";
import { PLAN_CHECK_MAX_RETRIES } from "../../../constants";
import { toModelMessages, type AgentResult } from "../utils/message-utils";
import { DEFAULT_CREATE_PLAN_TOOL } from "../default-tools/tool-utils";

const planCreated: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.toolResults.some((result) => result.toolName === DEFAULT_CREATE_PLAN_TOOL) ?? false;

export const planAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolSet | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a planning agent. Based on the as-needed background research and problem clarification, use the default/create_plan tool to map a plan for an execution-focused agent to complete step-by-step. Give each step a 1-based \`index\` and a concise \`description\`; the execution agent marks steps complete by index.`;
  const instructions = `${await frontLoadInstructions()}\n\n${systemPrompt}`;
  return retryModelCall(async () => streamText({
    model,
    instructions,
    messages: toModelMessages(messages),
    tools,
    toolChoice: { type: "tool", toolName: DEFAULT_CREATE_PLAN_TOOL },
    stopWhen: [planCreated, isStepCount(PLAN_CHECK_MAX_RETRIES + 1)],
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
    onStepFinish: (step) => onStep(step.response.messages),
  }));
}
