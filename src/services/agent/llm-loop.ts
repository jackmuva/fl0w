import type { Fl0wMessage, SubagentType } from "../../models/agent";
import type { ModelSelection } from "../../models/ai-model";
import { DEFAULT_MODELS } from "../../constants";
import { discoveryAgent } from "./subagents/discovery-agent";
import { planAgent } from "./subagents/plan-agent";
import { executeAgent } from "./subagents/execution-agent";
import { fl0wMessage, type AgentResult } from "./utils/fl0w-message";
import { routingAgent } from "./subagents/routing-agent";
import { summaryAgent } from "./subagents/summarize-agent";

type Phase = (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void) => Promise<AgentResult>;

// Phases the session hasn't picked a model for (null or "") fall back to DEFAULT_MODELS.
export const resolveModels = (selection: Partial<ModelSelection> | null | undefined): ModelSelection => {
  const resolved = { ...DEFAULT_MODELS };
  for (const phase of Object.keys(resolved) as (keyof ModelSelection)[]) {
    const picked = selection?.[phase]?.trim();
    if (picked) resolved[phase] = picked;
  }
  return resolved;
}

// Routes to a starting phase, runs each phase to completion (appending its messages so the next phase sees them), then summarizes.
export const llmLoop = async (
  messages: Fl0wMessage[],
  selection: ModelSelection | null,
  onMessages: (messages: Fl0wMessage[]) => void,
  abort: AbortSignal,
  onStreamText: (text: string | null) => void,
  sessionId: string,
): Promise<AgentResult> => {
  const models = resolveModels(selection);
  let transcript = messages;

  const runPhase = async (subagent: SubagentType, agent: Phase, model: string): Promise<AgentResult> => {
    // Agents emit deltas; callers render the accumulated text of the current phase.
    let streamed = "";
    const result = await agent(transcript, model, abort, (delta) => {
      streamed += delta;
      onStreamText(streamed);
    });
    await result.consumeStream();
    const { messages: produced } = await result.response;
    onStreamText(null);
    transcript = [...transcript, ...produced.map((message) => fl0wMessage(message, subagent))];
    onMessages(transcript);
    return result;
  };

  const state = await routingAgent(transcript, models.ROUTER, abort, onStreamText);
  if (state === "discovery") await runPhase("DISCOVERY", discoveryAgent, models.DISCOVERY);
  if (state === "discovery" || state === "plan") await runPhase("PLAN", planAgent, models.PLAN);
  await runPhase("EXECUTE", executeAgent, models.EXECUTE);
  return await runPhase("SUMMARY", summaryAgent, models.SUMMARIZE);
}
