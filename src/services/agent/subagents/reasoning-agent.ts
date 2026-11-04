import { experimental_decide, type JSONValue } from 'ai';
import type { Fl0wMessage } from '../../../models/agent';
import { retryModelCall } from '../../service-utils';
import { findLastUserAndAssistantMessages } from '../utils/message-utils';
import { sessionUsageStore } from '../../../store/session-usage-store';

export const REASONING_LEVELS = ['low', 'medium', 'high'] as const;
export type ReasoningLevel = typeof REASONING_LEVELS[number];

export const reasoningAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal): Promise<ReasoningLevel> => {
  const state: JSONValue = JSON.parse(
    JSON.stringify({ messages: findLastUserAndAssistantMessages(messages) }),
  );

  const result = await retryModelCall(() => experimental_decide({
    model,
    abortSignal: abort,
    state: [{ type: 'json', value: state }],
    questions: {
      level: {
        type: 'choice',
        instructions: `Based on the user's latest request and the assistant's most recent response (if any), how much reasoning effort should the agents spend completing this task?`,
        criteria: {
          low: 'Simple lookups, small or obvious one-step edits, or conversational replies.',
          medium: 'Typical multi-step tasks with moderate ambiguity.',
          high: 'Complex debugging, architecture or design decisions, subtle correctness concerns, or large refactors.',
        },
      },
    },
  }));
  sessionUsageStore.record(result);
  const choice = result.answers.level.choice;
  return (REASONING_LEVELS as readonly string[]).includes(choice) ? choice as ReasoningLevel : 'medium';
}
