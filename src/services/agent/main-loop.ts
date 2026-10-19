import type { Fl0wMessage } from '../../models/agent';
import type { AgentMode } from '../../models/config';
import { AGENT_MODE, LLM_MODEL, parseAgentMode, parseConfigString } from '../../constants';
import { decisionLoop } from './loops/decision-loop';
import { llmLoop } from './loops/llm-loop';
import type { Fl0wLoopOptions, fl0wLoopCallback, fl0wLoopResult } from './loops/utils';

export type { Fl0wLoopOptions, fl0wLoopCallback, fl0wLoopResult } from './loops/utils';

export const resolveAgentMode = (options?: Fl0wLoopOptions): AgentMode =>
  parseAgentMode(options?.mode) ?? AGENT_MODE;

export const fl0wLoop = async (
  messages: Fl0wMessage[],
  callback: fl0wLoopCallback,
  signal?: AbortSignal,
  options?: Fl0wLoopOptions,
): Promise<fl0wLoopResult> => {
  if (resolveAgentMode(options) === 'llm') {
    return llmLoop(
      messages,
      callback,
      signal,
      parseConfigString(options?.llmModel) ?? LLM_MODEL,
    );
  }
  return decisionLoop(messages, callback, signal);
};
