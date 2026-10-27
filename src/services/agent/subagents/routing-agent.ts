import { experimental_decide, type JSONValue } from 'ai';
import type { Fl0wMessage } from '../../../models/agent';
import { findLastUserAndSummaryMessages } from '../utils/message-utils';
import { sessionUsageStore } from '../../../store/session-usage-store';

export const routingAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void): Promise<"discovery" | "plan" | "execute"> => {
  const state: JSONValue = JSON.parse(
    JSON.stringify({ messages: findLastUserAndSummaryMessages(messages) }),
  );
  const result = await experimental_decide({
    model,
    abortSignal: abort,
    state: [{ type: 'json', value: state }],
    questions: {
      agent: {
        type: 'choice',
        instructions: 'Based on the user\'s requested task, do we need to clarify the problem and do background research, create a plan to complete the task, or start executing the task?',
        criteria: {
          discovery: "If the task is ambiguous or we need to do background research with read tools.",
          plan: "If the task is a multi-step problem, create a plan for an execution agent to start working on",
          execute: "If the task is ready for an agent to start working on",
        },
      },
    },
  });
  sessionUsageStore.record(result);
  return result.answers.agent.choice;
}
