import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import { frontLoadInstructions } from "../hooks/front-load";
import { MAX_ITERATIONS } from "../../../constants";
import { toModelMessages, type AgentResult } from "../utils/message-utils";

export const summaryAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolSet | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a summarizer agent that summarizes the work done in this session`;
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
