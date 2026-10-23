import type { AgentState, Fl0wMessage } from '../../../models/agent';
import type { AgentMode } from '../../../models/config';
import { fl0wMessage } from '../utils/fl0w-message';
import { formatAgentRunError } from './llm-error';

export type fl0wLoopCallback = (messages: Fl0wMessage[]) => void;

export type fl0wLoopResult = 'ok' | 'error' | 'stopped';

export type Fl0wLoopOptions = {
  mode?: AgentMode;
  llmModel?: string;
  decisionModel?: string;
  /** Live assistant text while a turn streams (LLM text, or decision-mode answers/plans); `null` once committed. */
  onStreamText?: (text: string | null) => void;
};


export const sync = (next: AgentState, callback: fl0wLoopCallback): AgentState => {
  callback(next.messages);
  return next;
};

export const stopIfAborted = (state: AgentState, callback: fl0wLoopCallback, signal?: AbortSignal,): AgentState | undefined => {
  if (!signal?.aborted) return undefined;
  return sync({
    state: 'END',
    messages: [
      ...state.messages,
      fl0wMessage({ role: 'assistant', content: 'Run stopped.' }),
    ],
  }, callback);
};

export const endRunWithError = (
  state: AgentState,
  error: unknown,
  callback: fl0wLoopCallback,
): AgentState => sync({
  state: 'END',
  messages: [
    ...state.messages,
    fl0wMessage({ role: 'assistant', content: formatAgentRunError(error) }),
  ],
}, callback);


