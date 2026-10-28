import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { findLastUserAndAssistantMessages, fl0wMessage } from './message-utils';

const user = (content: string) => fl0wMessage({ role: 'user', content });
const assistant = (content: string) => fl0wMessage({ role: 'assistant', content }, 'EXECUTE');
const toolCall = fl0wMessage({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'default/read', input: { path: 'a.ts' } }],
}, 'DISCOVERY');

const contents = (messages: ModelMessage[]) => messages.map((message) => message.content);

describe('findLastUserAndAssistantMessages', () => {
  test('returns only the user message on a first turn', () => {
    expect(contents(findLastUserAndAssistantMessages([user('hi')]))).toEqual(['hi']);
  });

  test('keeps the previous reply before the latest user message', () => {
    const messages = [user('fix it'), assistant('should I patch a.ts?'), user('yes')];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['should I patch a.ts?', 'yes']);
  });

  test('returns the phase reply after the user message', () => {
    const messages = [user('old'), assistant('old reply'), user('new'), assistant('found the bug')];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['new', 'found the bug']);
  });

  test('skips trailing tool-call-only assistant steps', () => {
    const messages = [user('go'), assistant('scoped the task'), toolCall];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['go', 'scoped the task']);
  });
});
