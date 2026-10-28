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

const hasText = (message: ModelMessage): boolean => typeof message.content === "string"
  ? message.content.trim().length > 0
  : message.content.some((part) => part.type === "text" && part.text.trim().length > 0);

// Skips tool-call-only assistant steps so the router sees the phase's conclusion, not its last action.
export const findLastUserAndAssistantMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  let lastUser = -1;
  let lastAssistant = -1;

  for (let i = messages.length - 1; i >= 0 && (lastUser < 0 || lastAssistant < 0); i--) {
    const message = messages[i]?.message;
    if (!message) continue;
    if (lastUser < 0 && message.role === "user") lastUser = i;
    if (lastAssistant < 0 && message.role === "assistant" && hasText(message)) lastAssistant = i;
  }

  return [lastUser, lastAssistant]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
    .map((index) => messages[index]!.message);
};
