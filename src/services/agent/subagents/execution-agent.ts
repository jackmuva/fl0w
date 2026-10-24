import { isStepCount, streamText, type ModelMessage } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import type { AgentResult } from "../utils/fl0w-message";
import { frontLoadMessages } from "../hooks/front-load";
import { toModelMessages } from "../utils/fl0w-message";
import { MAX_ITERATIONS } from "../../../constants";

export const executeAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void): Promise<AgentResult> => {
  const systemPrompt = `You are an execution agent. If there is a plan created, follow the plan above. Once you've completed a step in the plan, call the default/mark_step_complete tool to mark it complete. The task will not be considered complete without useing the tool.`;
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
