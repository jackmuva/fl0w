import type { ModelMessage } from 'ai';
import type { Fl0wMessage, Fl0wMessageFrame } from '../../../models/agent';

export const fl0wMessage = (
  message: ModelMessage,
  frame?: Fl0wMessageFrame,
): Fl0wMessage => ({
  message,
  ...(frame && { frame }),
});

export const toModelMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  const included = messages.filter(({ frame }) => !frame);
  const system = included.filter(({ message }) => message.role === 'system');
  const summaries = included.filter(({ frame }) => frame === 'summary');
  const rest = included.filter(
    ({ message, frame }) => message.role !== 'system' && frame !== 'summary',
  );
  return [...system, ...summaries, ...rest].map(({ message }) => message);
};
