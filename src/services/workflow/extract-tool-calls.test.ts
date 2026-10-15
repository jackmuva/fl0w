import { describe, expect, test } from 'bun:test';
import type { Fl0wMessage } from '../../models/agent';
import { extractToolCalls, hasConversationContent } from './extract-tool-calls';

describe('extractToolCalls', () => {
  test('extracts tool calls from assistant messages', () => {
    const messages: Fl0wMessage[] = [
      { message: { role: 'user', content: 'search the repo' } },
      {
        message: {
          role: 'assistant',
          content: [{
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'Grep',
            input: { pattern: 'SessionStore' },
          }],
        },
      },
    ];

    expect(extractToolCalls(messages)).toEqual([
      { toolName: 'Grep', input: { pattern: 'SessionStore' } },
    ]);
  });

  test('detects conversation content', () => {
    expect(hasConversationContent([
      { message: { role: 'system', content: 'rules' } },
    ])).toBe(false);

    expect(hasConversationContent([
      { message: { role: 'user', content: 'hello' } },
    ])).toBe(true);
  });
});
