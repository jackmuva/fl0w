import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import type { AgentResult } from "../utils/fl0w-message";
import { frontLoadInstructions } from "../hooks/front-load";
import { toModelMessages } from "../utils/fl0w-message";
import { MAX_ITERATIONS } from "../../../constants";

export const executeAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolSet | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const systemPrompt = `You are an execution agent. If there is a plan created, follow the plan above. Once you've completed a step in the plan, call the default/mark_step_complete tool with that step's index to mark it complete. The task will not be considered complete without using the tool.`;
  return streamText({
    model,
    instructions: `${await frontLoadInstructions()}\n\n${systemPrompt}`,
    messages: toModelMessages(messages),
    tools,
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
    onStepFinish: (step) => onStep(step.response.messages),
  });
}
