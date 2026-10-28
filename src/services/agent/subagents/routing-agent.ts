import { experimental_decide, type JSONValue } from 'ai';
import type { Fl0wMessage } from '../../../models/agent';
import { retryModelCall } from '../../service-utils';
import { findLastUserAndAssistantMessages } from '../utils/message-utils';
import { sessionUsageStore } from '../../../store/session-usage-store';

export const routingAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, options: { discovery: boolean, plan: boolean, execute: boolean, taskComplete: boolean } = { discovery: true, plan: true, execute: true, taskComplete: true },): Promise<string> => {
  const state: JSONValue = JSON.parse(
    JSON.stringify({ messages: findLastUserAndAssistantMessages(messages) }),
  );

  const criteria: { [agent: string]: string } = {};
  if (options.discovery) criteria["discovery"] = "If the task is ambiguous or we need to do background research"
  if (options.plan) criteria["plan"] = "If the task is a multi-step problem that needs a multi-step plan"
  if (options.execute) criteria["execute"] = "If the task is ready for an agent to start working on"
  if (options.taskComplete) criteria["taskComplete"] = "If no additional work is needed"

  const result = await retryModelCall(() => experimental_decide({
    model,
    abortSignal: abort,
    state: [{ type: 'json', value: state }],
    questions: {
      agent: {
        type: 'choice',
        instructions: `Based on the user's latest request and the assistant's most recent response (if any), do we need to clarify the problem and do background research, create a plan to complete the task, start executing the task${options.taskComplete ? ', or is the task already done' : ''}?`,
        criteria,
      },
    },
  }));
  sessionUsageStore.record(result);
  return result.answers.agent.choice;
}
