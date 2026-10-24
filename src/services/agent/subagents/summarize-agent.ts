import { isStepCount, streamText, type ModelMessage } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import { frontLoadMessages } from "../hooks/front-load";
import { MAX_ITERATIONS } from "../../../constants";
import { toModelMessages, type AgentResult } from "../utils/fl0w-message";

export const summaryAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a summarizer agent that summarizes the work done in this session`;
  return streamText({
    model,
    messages: [...(await frontLoadMessages()), { role: "system", content: systemPrompt } as ModelMessage, ...toModelMessages(messages)],
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
  });
}
