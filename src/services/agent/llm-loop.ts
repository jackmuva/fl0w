import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import { MAX_ITERATIONS } from "../../constants";
import type { AgentState, Fl0wMessage } from "../../models/agent";
import { toModelMessages } from "./utils/fl0w-message";
import { frontLoadMessages } from "./hooks/front-load";

type AgentResult = ReturnType<typeof streamText<ToolSet>>;

// Runs discovery and plan to completion, then hands back the execute phase's stream unconsumed.
export const llmLoop = async (agentState: AgentState, abort: AbortSignal, onStreamText: (text: string) => void, sessionId: string): Promise<AgentResult> => {
  await (await discoveryAgent(agentState.messages, abort, onStreamText)).consumeStream();
  await (await planAgent(agentState.messages, abort, onStreamText)).consumeStream();
  return await executeAgent(agentState.messages, abort, onStreamText);
}

const discoveryAgent = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a subagent tasked with fully scoping the problem and the current state of the project.

For coding projects, please find the AGENTS.md and README.md if present.

Use the default/ask_question tool to ask users any clarifying questions. Do not ask questions if the task is clear.

Depending on the task and project you are in, perform any sort of background research so that a planning agent will be able to take your research and develop a solid plan for an agent to execute.

Be thorough AND concise. Only your last message will be delivered to the planning agent so deliver your report there.`;
  return streamText({
    model: "anthropic/claude-opus-5.5",
    messages: [...(await frontLoadMessages()), { role: "system", content: systemPrompt } as ModelMessage, ...toModelMessages(messages)],
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
  });
}

const planAgent = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a planning agent. Based on the as-needed background research and problem clarification, use the default/plan_tool to map a plan for an execution-focused agent to complete step-by-step`;
  return streamText({
    model: "anthropic/claude-opus-5.5",
    messages: [...(await frontLoadMessages()), { role: "system", content: systemPrompt } as ModelMessage, ...toModelMessages(messages)],
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
  });
}

const executeAgent = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void): Promise<AgentResult> => {
  const systemPrompt = ``;
  return streamText({
    model: "anthropic/claude-opus-5.5",
    messages: toModelMessages(messages),
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
  });
}
