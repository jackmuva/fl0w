import { experimental_decide, type JSONValue } from 'ai';
import type { Fl0wMessage } from '../../../models/agent';
import { retryModelCall } from '../../service-utils';
import { findLastUserAndSummaryMessages } from '../utils/message-utils';
import { sessionUsageStore } from '../../../store/session-usage-store';

export const routingAgent = async (messages: Fl0wMessage[], model: string, abort: AbortSignal, onStreamText: (text: string) => void, options: { discovery: boolean, plan: boolean, execute: boolean } = { discovery: true, plan: true, execute: true },): Promise<string> => {
  const state: JSONValue = JSON.parse(
    JSON.stringify({ messages: findLastUserAndSummaryMessages(messages) }),
  );

  const criteria: { [agent: string]: string } = { "taskComplete": "No additional work is needed." };
  if (options.discovery) criteria["discovery"] = "If the task is ambiguous or we need to do background research"
  if (options.plan) criteria["plan"] = "If the task is a multi-step problem that needs a multi-step plan"
  if (options.execute) criteria["execute"] = "If the task is ready for an agent to start working on"

  const result = await retryModelCall(() => experimental_decide({
    model,
    abortSignal: abort,
    state: [{ type: 'json', value: state }],
    questions: {
      agent: {
        type: 'choice',
        instructions: 'Based on the user\'s requested task, do we need to clarify the problem and do background research, create a plan to complete the task, start executing the task, or is the task already done?',
        criteria,
      },
    },
  }));
  sessionUsageStore.record(result);
  return result.answers.agent.choice;
}
