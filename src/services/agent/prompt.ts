import type { ModelMessage } from 'ai';
import type { Fl0wMessage } from '../../models/agent';
import { toModelMessages } from './utils/fl0w-message';

export const preparePrompt = (
  instructions: string,
  fl0wMessages: Fl0wMessage[],
): { instructions: string; messages: ModelMessage[] } => {
  const messages = toModelMessages(fl0wMessages);
  const systemTexts = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.role !== 'system' ? '' : message.content)
    .filter(Boolean);

  const chatMessages = messages.filter((message) => message.role !== 'system');

  const mergedInstructions = systemTexts.length > 0
    ? `${systemTexts.join('\n\n')}\n\n${instructions}`
    : instructions;

  return { instructions: mergedInstructions, messages: chatMessages };
};
