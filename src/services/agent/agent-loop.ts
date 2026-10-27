import { NoOutputGeneratedError, type ModelMessage, type ToolSet } from "ai";
import type { Fl0wMessage, ModelSelection, SubagentType } from "../../models/agent";
import { DEFAULT_MODELS } from "../../constants";
import { discoveryAgent } from "./subagents/discovery-agent";
import { planAgent } from "./subagents/plan-agent";
import { executeAgent } from "./subagents/execution-agent";
import { fl0wMessage, type AgentResult } from "./utils/message-utils";
import { routingAgent } from "./subagents/routing-agent";
import { summaryAgent } from "./subagents/summarize-agent";
import { compactionHook } from "./hooks/compaction";
import { modelStore } from "../../store/model-store";
import { toolsFor } from "./toolpacks";
import { sessionUsageStore } from "../../store/session-usage-store";
import { findPendingAskQuestion } from "./utils/question-utils";
import { activeWorkflowStore } from "../../store/active-workflow-store";

export type Phase = (
  messages: Fl0wMessage[],
  model: string,
  abort: AbortSignal,
  onStreamText: (text: string) => void,
  tools: ToolSet | undefined,
  onStep: (stepMessages: ModelMessage[]) => void,
) => Promise<AgentResult>;

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
  onPhase?: (subagent: SubagentType | null) => void,
): Promise<{ result: AgentResult, transcript: Fl0wMessage[] }> => {
  onPhase?.(subagent);
  let streamed = "";
  // Publish each finished step so tool calls (e.g. plan progress) show up before the phase ends.
  let stepped: Fl0wMessage[] = [];
  const onStep = (stepMessages: ModelMessage[]) => {
    stepped = [...stepped, ...stepMessages.map((message) => fl0wMessage(message, subagent))];
    streamed = "";
    onStreamText(null);
    onMessages([...transcript, ...stepped]);
  };
  const result = await agent(transcript, model, abort, (delta) => {
    streamed += delta;
    onStreamText(streamed);
  }, await toolsFor(subagent), onStep);
  const window = await modelStore.contextWindowFor(model);
  let streamError: unknown;
  for await (const part of result.fullStream) {
    if (part.type === "error") streamError ??= part.error;
    if (part.type === "finish-step") sessionUsageStore.record(part, window);
  }
  // An aborted stream just ends, so stop here instead of waiting on its response or starting the next phase.
  abort.throwIfAborted();
  let produced: Awaited<AgentResult["response"]>["messages"];
  try {
    ({ messages: produced } = await result.response);
  } catch (error) {
    if (!NoOutputGeneratedError.isInstance(error) || streamError === undefined) throw error;
    const reason = streamError instanceof Error ? streamError.message : String(streamError);
    throw new Error(`${subagent} phase failed (${model}): ${reason}`, { cause: streamError });
  }
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
  // Reports which subagent phase is running (null once the loop ends) so the UI can collapse finished phases.
  onPhase?: (subagent: SubagentType | null) => void,
): Promise<AgentResult> => {
  try {
    return await runLoop(messages, selection, onMessages, abort, onStreamText, onPhase);
  } finally {
    // A workflow covers one run; follow-up turns go through the normal routing.
    activeWorkflowStore.clear();
    onPhase?.(null);
  }
}

const runLoop = async (
  messages: Fl0wMessage[],
  selection: ModelSelection | null,
  onMessages: (messages: Fl0wMessage[]) => void,
  abort: AbortSignal,
  onStreamText: (text: string | null) => void,
  onPhase?: (subagent: SubagentType | null) => void,
): Promise<AgentResult> => {
  const models = resolveModels(selection);
  // A workflow arrives with its plan already seeded, so it goes straight to execution.
  const state = activeWorkflowStore.get() ? "execute" : await routingAgent(messages, models.ROUTER, abort, onStreamText);

  const compact = async (transcript: Fl0wMessage[], target: string): Promise<Fl0wMessage[]> => {
    abort.throwIfAborted();
    const compacted = await compactionHook(transcript, models.SUMMARIZE, await modelStore.contextWindowFor(target));
    if (compacted !== transcript) onMessages(compacted);
    return compacted;
  };

  let transcript = messages;
  let result: AgentResult;
  if (state === "discovery") {
    transcript = await compact(transcript, models.DISCOVERY);
    ({ result, transcript } = await runPhase("DISCOVERY", discoveryAgent, models.DISCOVERY, onMessages, onStreamText, transcript, abort, onPhase));
    // ask_question has no execute step: hand control back to the UI until the user answers.
    if (findPendingAskQuestion(transcript)) return result;
  }

  if (state === "discovery" || state === "plan") {
    transcript = await compact(transcript, models.PLAN);
    ({ transcript } = await runPhase("PLAN", planAgent, models.PLAN, onMessages, onStreamText, transcript, abort, onPhase));
  }

  transcript = await compact(transcript, models.EXECUTE);
  ({ transcript } = await runPhase("EXECUTE", executeAgent, models.EXECUTE, onMessages, onStreamText, transcript, abort, onPhase));
  return (await runPhase("SUMMARY", summaryAgent, models.SUMMARIZE, onMessages, onStreamText, transcript, abort, onPhase)).result;
}
