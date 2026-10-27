import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import { MAX_ITERATIONS } from "../../../constants";
import type { Fl0wMessage } from "../../../models/agent";
import { toModelMessages, type AgentResult } from "../utils/message-utils";
import { frontLoadInstructions } from "../hooks/front-load";

export const discoveryAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolSet | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a subagent tasked with fully scoping the problem and the current state of the project.

For coding projects, please find the AGENTS.md and README.md if present.

Use the default/ask_question tool to ask users any clarifying questions. Do not ask questions if the task is clear.

Depending on the task and project you are in, perform any sort of background research so that a planning agent will be able to take your research and develop a solid plan for an agent to execute.

Be thorough AND concise. Only your last message will be delivered to the planning agent so deliver your report there.`;
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


