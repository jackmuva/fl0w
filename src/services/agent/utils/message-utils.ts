import type { ModelMessage } from 'ai';
import type { Fl0wMessage, SubagentType } from '../../../models/agent';
import { streamText, type ToolSet } from "ai";

export type AgentResult = ReturnType<typeof streamText<ToolSet>>;

export const fl0wMessage = (
  message: ModelMessage,
  subagent?: SubagentType,
): Fl0wMessage => ({
  message,
  ...(subagent && { subagent }),
});

export const toModelMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  return messages.filter((message) => message.message.role !== "system").map((message) => message.message);
};

export const findLastUserAndSummaryMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  let lastSummary: ModelMessage | undefined;
  let lastUser: ModelMessage | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i];
    if (!entry) continue;
    const { message, subagent } = entry;
    if (!lastSummary && subagent === "SUMMARY") lastSummary = message;
    if (!lastUser && message.role === "user") lastUser = message;
    if (lastSummary && lastUser) break;
  }

  return [lastSummary, lastUser].filter((message): message is ModelMessage => message !== undefined);
};
