import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import type { AgentResult } from "../utils/message-utils";
import { retryModelCall } from "../../service-utils";
import { frontLoadInstructions } from "../hooks/front-load";
import { activeWorkflowStore } from "../../../store/active-workflow-store";
import { toModelMessages } from "../utils/message-utils";
import { MAX_ITERATIONS } from "../../../constants";

export const executeAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolSet | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const workflowPrompt = activeWorkflowStore.get()
    ? ` You are running the saved workflow described in <workflow>: carry out each step with the tools and parameters it lists rather than improvising a different approach.`
    : "";
  const systemPrompt = `You are an execution agent. If there is a plan created, follow the plan above. Once you've completed a step in the plan, call the default/mark_step_complete tool with that step's index to mark it complete. The task will not be considered complete without using the tool.${workflowPrompt}`;
  const instructions = `${await frontLoadInstructions()}\n\n${systemPrompt}`;
  return retryModelCall(async () => streamText({
    model,
    instructions,
    messages: toModelMessages(messages),
    tools,
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
    onStepFinish: (step) => onStep(step.response.messages),
  }));
}
