import { streamText, type ModelMessage, type ToolSet } from 'ai';
import { HEADLESS, LLM_MODEL, MAX_ITERATIONS } from '../../../constants';
import type { AgentState, Fl0wMessage } from '../../../models/agent';
import { mcpClient } from '../../mcp/mcp-client';
import { retryModelCall } from '../../utils';
import { type CreatePlanInput } from '../default-tools/create-plan';
import { compactMessages, compactionHook } from '../hooks/compaction';
import { recordLlmUsage } from '../hooks/session-usage';
import { endRunWithError, stopIfAborted, sync } from './utils';
import { preparePrompt } from '../prompt';
import { findPendingAskQuestion } from '../utils/ask-question-state';
import { fl0wMessage } from '../utils/fl0w-message';
import {
  ASK_QUESTION_ACTION,
  CREATE_PLAN_ACTION,
  executeNamedTool,
  listAllTools,
  toAiSdkTools,
} from '../utils/tools';

export type LlmStreamText = typeof streamText;

let streamLlmText: LlmStreamText = streamText;

/** Test-only hook so unit tests can stub model calls without mocking the `ai` package. */
export const setLlmStreamText = (fn: LlmStreamText): void => {
  streamLlmText = fn;
};

export const resetLlmStreamText = (): void => {
  streamLlmText = streamText;
};

type LoopCallback = (messages: Fl0wMessage[]) => void;
/** Receives the assistant text streamed so far in the current turn; `null` once the turn is committed. */
export type StreamTextCallback = (text: string | null) => void;
type LoopResult = 'ok' | 'error' | 'stopped';

const LLM_INSTRUCTIONS = [
  "You are a software engineering agent. Use the available tools to complete the user's task.",
  'Call tools when you need to inspect or change the workspace, search, or fetch information.',
  'When the task is complete, respond with a concise final answer in text without calling a tool.',
  !HEADLESS && `If the task is too ambiguous to proceed, call ${ASK_QUESTION_ACTION} with 1-3 focused questions (include an "other" option).`,
  `For multi-step work you may call ${CREATE_PLAN_ACTION} with a short numbered plan before executing.`,
].filter(Boolean).join(' ');

const toolResultMessage = (
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): ModelMessage => ({
  role: 'tool',
  content: [{
    type: 'tool-result',
    toolCallId,
    toolName,
    output: { type: isError ? 'error-text' : 'text', value: content },
  }],
});

const assistantFromTurn = (text: string, toolCalls: Array<{
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid?: boolean;
}>): ModelMessage | undefined => {
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (const call of toolCalls) {
    if (call.invalid) continue;
    parts.push({
      type: 'tool-call',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    });
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return { role: 'assistant', content: parts[0].text };
  }
  return { role: 'assistant', content: parts };
};

const executeLlmToolCall = async (call: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid?: boolean;
  error?: unknown;
}): Promise<ModelMessage | undefined> => {
  if (call.invalid) {
    const detail = call.error instanceof Error ? call.error.message : 'Invalid tool call.';
    return toolResultMessage(call.toolCallId, call.toolName, detail, true);
  }
  if (call.toolName === ASK_QUESTION_ACTION) return undefined;

  if (call.toolName === CREATE_PLAN_ACTION) {
    const plan = typeof call.input === 'object' && call.input && 'plan' in call.input
      ? String((call.input as CreatePlanInput).plan)
      : '';
    if (!plan.trim()) {
      return toolResultMessage(call.toolCallId, call.toolName, 'create_plan requires a non-empty plan.', true);
    }
    return toolResultMessage(call.toolCallId, call.toolName, plan);
  }

  const result = await executeNamedTool(call.toolName, (call.input ?? {}) as Record<string, unknown>);
  return mcpClient.toMessage(call.toolCallId, result);
};

const runLlmTurn = async (
  state: AgentState,
  model: string,
  callback: LoopCallback,
  signal?: AbortSignal,
  onStreamText?: StreamTextCallback,
): Promise<AgentState> => {
  const availableTools = await listAllTools();
  const tools: ToolSet = toAiSdkTools(availableTools);
  const prompt = preparePrompt(LLM_INSTRUCTIONS, state.messages);
  const result = await retryModelCall(async () => {
    const stream = streamLlmText({
      model,
      abortSignal: signal,
      instructions: prompt.instructions,
      messages: prompt.messages,
      tools,
      // Errors are rethrown from the stream below; skip the SDK's default console.error.
      onError: () => {},
    });
    let text = '';
    for await (const part of stream.fullStream) {
      if (part.type === 'error') throw part.error;
      if (part.type !== 'text-delta') continue;
      text += part.text;
      onStreamText?.(text);
    }
    return {
      text: await stream.text,
      toolCalls: await stream.toolCalls,
      usage: await stream.usage,
      providerMetadata: await stream.providerMetadata,
    };
  });
  recordLlmUsage(result);

  const toolCalls = result.toolCalls;
  const assistant = assistantFromTurn(result.text, toolCalls);
  let messages = assistant
    ? [...state.messages, fl0wMessage(assistant)]
    : [...state.messages];
  // Commit the streamed text before running tools so it stays visible while they execute.
  if (assistant) callback(messages);
  onStreamText?.(null);

  for (const call of toolCalls) {
    const toolMessage = await executeLlmToolCall(call);
    if (toolMessage) messages = [...messages, fl0wMessage(toolMessage)];
  }

  const hasToolCalls = toolCalls.length > 0;
  if (hasToolCalls) messages = await compactMessages(messages);

  return {
    state: hasToolCalls ? 'EXECUTE' : 'END',
    messages,
  };
};

export const llmLoop = async (
  messages: Fl0wMessage[],
  callback: LoopCallback,
  signal?: AbortSignal,
  model: string = LLM_MODEL,
  onStreamText?: StreamTextCallback,
): Promise<LoopResult> => {
  let state: AgentState = { state: 'START', messages: [...messages] };
  if (findPendingAskQuestion(state.messages)) return 'ok';

  let i = 0;
  while (i < MAX_ITERATIONS) {
    const loopEnded = stopIfAborted(state, callback, signal);
    if (loopEnded) {
      state = loopEnded;
      return 'stopped';
    }

    let current = sync(await compactionHook(state), callback);
    let ended = stopIfAborted(current, callback, signal);
    if (ended) return 'stopped';

    try {
      current = sync(await runLlmTurn(current, model, callback, signal, onStreamText), callback);
    } catch {
      onStreamText?.(null);
      try {
        current = sync(await compactionHook(current, true), callback);
        current = sync(await runLlmTurn(current, model, callback, signal, onStreamText), callback);
      } catch (retryError) {
        onStreamText?.(null);
        endRunWithError(current, retryError, callback);
        return 'error';
      }
    }

    ended = stopIfAborted(current, callback, signal);
    if (ended) return 'stopped';
    current = sync(await compactionHook(current), callback);
    ended = stopIfAborted(current, callback, signal);
    if (ended) return 'stopped';

    state = current;
    if (findPendingAskQuestion(state.messages)) return 'ok';
    if (state.state === 'END') return 'ok';
    i += 1;
  }

  sync({
    state: 'END',
    messages: [...state.messages, fl0wMessage({
      role: 'assistant',
      content: 'Unable to complete the task with given tools',
    })],
  }, callback);
  return 'ok';
};
