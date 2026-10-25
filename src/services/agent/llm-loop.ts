import type { Fl0wMessage, SubagentType } from "../../models/agent";
import type { ModelSelection } from "../../models/ai-model";
import { DEFAULT_MODELS } from "../../constants";
import { discoveryAgent } from "./subagents/discovery-agent";
import { planAgent } from "./subagents/plan-agent";
import { executeAgent } from "./subagents/execution-agent";
import { fl0wMessage, type AgentResult } from "./utils/fl0w-message";
import { routingAgent } from "./subagents/routing-agent";
import { summaryAgent } from "./subagents/summarize-agent";
import { compactionHook } from "./hooks/compaction";
import { contextWindowFor } from "../model-registry";

type Phase = (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void) => Promise<AgentResult>;

export const resolveModels = (selection: Partial<ModelSelection> | null | undefined): ModelSelection => {
  const resolved = { ...DEFAULT_MODELS };
  for (const phase of Object.keys(resolved) as (keyof ModelSelection)[]) {
    const picked = selection?.[phase]?.trim();
    if (picked) resolved[phase] = picked;
  }
  return resolved;
}

const runPhase = async (
  subagent: SubagentType,
  agent: Phase,
  model: string,
  onMessages: (messages: Fl0wMessage[]) => void,
  onStreamText: (text: string | null) => void,
  transcript: Fl0wMessage[],
  abort: AbortSignal,
): Promise<{ result: AgentResult, transcript: Fl0wMessage[] }> => {
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
  return { result, transcript };
};

export const llmLoop = async (
  messages: Fl0wMessage[],
  selection: ModelSelection | null,
  onMessages: (messages: Fl0wMessage[]) => void,
  abort: AbortSignal,
  onStreamText: (text: string | null) => void,
): Promise<AgentResult> => {
  const models = resolveModels(selection);
  const state = await routingAgent(messages, models.ROUTER, abort, onStreamText);

  const compact = async (transcript: Fl0wMessage[], target: string): Promise<Fl0wMessage[]> => {
    const compacted = await compactionHook(transcript, models.SUMMARIZE, await contextWindowFor(target));
    if (compacted !== transcript) onMessages(compacted);
    return compacted;
  };

  let transcript = messages;
  if (state === "discovery") {
    transcript = await compact(transcript, models.DISCOVERY);
    ({ transcript } = await runPhase("DISCOVERY", discoveryAgent, models.DISCOVERY, onMessages, onStreamText, transcript, abort));
  }

  if (state === "discovery" || state === "plan") {
    transcript = await compact(transcript, models.PLAN);
    ({ transcript } = await runPhase("PLAN", planAgent, models.PLAN, onMessages, onStreamText, transcript, abort));
  }

  transcript = await compact(transcript, models.EXECUTE);
  ({ transcript } = await runPhase("EXECUTE", executeAgent, models.EXECUTE, onMessages, onStreamText, transcript, abort));
  return (await runPhase("SUMMARY", summaryAgent, models.SUMMARIZE, onMessages, onStreamText, transcript, abort)).result;
}
