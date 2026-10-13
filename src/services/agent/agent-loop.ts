import { findPendingAskQuestion } from './utils/ask-question-state';
import type { AgentState, JevMessage } from '../../models/agent';
import { clarifyTaskNode, createPlanNode, initialNode, runToolNode, actionSelectNode } from './graph';
import { compactionHook } from './hooks/compaction';
import { rewindState } from './hooks/rewind';
import { formatAgentRunError } from './llm-error';
import { jevMessage } from './utils/jev-message';
import { MAX_ITERATIONS } from '../../constants';

export type JevLoopOptions = {
  signal?: AbortSignal;
};

export type JevLoopResult = 'ok' | 'error' | 'stopped';

const sync = (next: AgentState, callback: (messages: JevMessage[]) => void): AgentState => {
  callback(next.messages);
  return next;
};

const stopIfAborted = (state: AgentState, callback: (messages: JevMessage[]) => void, signal?: AbortSignal,): AgentState | undefined => {
  if (!signal?.aborted) return undefined;
  return sync({
    state: 'END',
    messages: [
      ...state.messages,
      jevMessage({ role: 'assistant', content: 'Run stopped.' }),
    ],
  }, callback);
};

const endRunWithError = (
  state: AgentState,
  error: unknown,
  callback: (messages: JevMessage[]) => void,
): AgentState => sync({
  state: 'END',
  messages: [
    ...state.messages,
    jevMessage({ role: 'assistant', content: formatAgentRunError(error) }),
  ],
}, callback);

const runNode = async (state: AgentState, node: (state: AgentState) => Promise<AgentState>, callback: (messages: JevMessage[]) => void, signal?: AbortSignal,): Promise<{ ok: boolean; state: AgentState }> => {
  let current = sync(await compactionHook(state), callback);
  let ended = stopIfAborted(current, callback, signal);
  if (ended) return { ok: false, state: ended };

  try {
    current = sync(await node(current), callback);
  } catch {
    try {
      current = sync(await compactionHook(current, true), callback);
      current = sync(await node(current), callback);
    } catch (retryError) {
      return { ok: false, state: endRunWithError(current, retryError, callback) };
    }
  }

  ended = stopIfAborted(current, callback, signal);
  if (ended) return { ok: false, state: ended };
  current = sync(await compactionHook(current), callback);
  ended = stopIfAborted(current, callback, signal);
  if (ended) return { ok: false, state: ended };
  return { ok: true, state: current };
};

export const jevLoop = async (
  messages: JevMessage[],
  callback: (messages: JevMessage[]) => void,
  options?: JevLoopOptions,
): Promise<JevLoopResult> => {
  const signal = options?.signal;
  let state: AgentState = { state: 'START', messages: [...messages] };

  if (findPendingAskQuestion(state.messages)) return 'ok';

  let result = await runNode(state, initialNode, callback, signal);
  state = result.state;
  if (!result.ok) return 'error';
  if (state.state === 'END') return 'ok';

  if (state.state === 'PLAN') {
    result = await runNode(state, createPlanNode, callback, signal);
    state = result.state;
    if (!result.ok) return 'error';
  } else if (state.state === 'DISCOVERY') {
    result = await runNode(state, clarifyTaskNode, callback, signal);
    state = result.state;
    if (!result.ok) return 'error';
    if (findPendingAskQuestion(state.messages)) return 'ok';
  }

  let checkpoints: Array<{ state: AgentState; options: string[] }> = [];
  let i = 0;
  while (i < MAX_ITERATIONS) {
    const loopEnded = stopIfAborted(state, callback, signal);
    if (loopEnded) {
      state = loopEnded;
      return 'stopped';
    }

    if (state.state !== 'REWIND' && !state.selectedTool) {
      let actionSelectCheckpoint: { state: AgentState; options: string[] } | null = null;
      result = await runNode(state, async (s) => {
        const { state: newState, options } = await actionSelectNode(s);
        if (options.length > 0 && newState.state === 'EXECUTE') {
          actionSelectCheckpoint = { state: { ...newState }, options };
        }
        return newState;
      }, callback, signal);
      state = result.state;
      if (!result.ok) return 'error';
      if (actionSelectCheckpoint) checkpoints.push(actionSelectCheckpoint);
    }

    const runningTool = state.state === 'EXECUTE';
    if (runningTool) {
      result = await runNode(state, runToolNode, callback, signal);
      state = result.state;
      if (!result.ok) return 'error';
    }
    if (runningTool) {
      if (state.state === 'DISCOVERY' || findPendingAskQuestion(state.messages)) return 'ok';
      state = sync({ ...state, selectedTool: undefined, probabilities: undefined }, callback);
    }

    if (state.state === 'END') return 'ok';
    if (state.state === 'REWIND') {
      const { state: rewoundState, checkpoints: rewoundCheckpoints } = rewindState(checkpoints, state);
      checkpoints = rewoundCheckpoints;
      state = sync(rewoundState, callback);
      if (checkpoints.length === 0) {
        state = sync({
          state: 'END',
          messages: [...state.messages, jevMessage({
            role: 'assistant',
            content: 'Unable to complete the task with given tools',
          })],
        }, callback);
        return 'ok';
      }
    }
    i += 1;
  }

  sync({
    state: 'END',
    messages: [...state.messages, jevMessage({
      role: 'assistant',
      content: 'Unable to complete the task with given tools',
    })],
  }, callback);
  return 'ok';
};
