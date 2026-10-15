import type { Fl0wMessage } from '../../models/agent';

export type ExtractedToolCall = {
  toolName: string;
  input: unknown;
};

export const extractToolCalls = (messages: Fl0wMessage[]): ExtractedToolCall[] => {
  const calls: ExtractedToolCall[] = [];

  for (const { message } of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      calls.push({ toolName: part.toolName, input: part.input });
    }
  }

  return calls;
};

export const hasConversationContent = (messages: Fl0wMessage[]): boolean =>
  messages.some(({ message }) => message.role === 'user' || message.role === 'assistant');
