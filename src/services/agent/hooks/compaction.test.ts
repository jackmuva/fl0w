import { describe, expect, test } from 'bun:test';
import { mapToolResultOutput } from 'ai/internal';
import type { Fl0wMessage } from '../../../models/agent';
import { COMPACTION_TOKEN_THRESHOLD } from '../../../constants';
import { estimateMessagesTokens, shrinkMessagesToTokenBudget } from './compaction';

// Fixed window so payload sizes stay meaningful regardless of DEFAULT_CONTEXT_WINDOW.
const TEST_CONTEXT_WINDOW = 32_000;

const largeToolResult = (size: number): Fl0wMessage => ({ message: {
  role: 'tool',
  content: [{
    type: 'tool-result',
    toolCallId: 'call-1',
    toolName: 'default/read_file',
    output: { type: 'text', value: 'x'.repeat(size) },
  }],
} });

describe('estimateMessagesTokens', () => {
  test('counts full tool-result payloads, not a truncated preview', () => {
    const payloadSize = 30_000;
    const messages: Fl0wMessage[] = [
      { message: { role: 'user', content: 'read the file' } },
      largeToolResult(payloadSize),
    ];

    const estimate = estimateMessagesTokens(messages);
    const truncatedPreviewTokens = Math.ceil(500 / 3);

    expect(estimate).toBeGreaterThan(truncatedPreviewTokens * 10);
    expect(estimate).toBeGreaterThanOrEqual(Math.ceil(payloadSize / 3));
  });

  test('exceeds compaction threshold when history is large enough', () => {
    const messages: Fl0wMessage[] = [
      { message: { role: 'user', content: 'analyze these files' } },
      largeToolResult(80_000),
    ];

    const estimate = estimateMessagesTokens(messages);
    const tokenLimit = TEST_CONTEXT_WINDOW * COMPACTION_TOKEN_THRESHOLD;

    expect(estimate).toBeGreaterThan(tokenLimit);
  });
});

describe('shrinkMessagesToTokenBudget', () => {
  test('truncates retained tool output when everything is in the keep window', () => {
    const messages: Fl0wMessage[] = [
      { message: { role: 'user', content: 'read the file' } },
      largeToolResult(80_000),
    ];
    const tokenLimit = TEST_CONTEXT_WINDOW * COMPACTION_TOKEN_THRESHOLD;

    expect(estimateMessagesTokens(messages)).toBeGreaterThan(tokenLimit);

    const shrunk = shrinkMessagesToTokenBudget(messages, tokenLimit);

    expect(estimateMessagesTokens(shrunk)).toBeLessThanOrEqual(tokenLimit);
    const toolPart = shrunk[1]?.message;
    expect(toolPart?.role).toBe('tool');
    if (toolPart?.role === 'tool' && Array.isArray(toolPart.content)) {
      const value = toolPart.content[0]?.type === 'tool-result' && 'value' in toolPart.content[0].output
        ? toolPart.content[0].output.value
        : '';
      expect(String(value).length).toBeLessThan(80_000);
    }
  });

  test('truncates older tool results before the latest tool result', () => {
    const payload = (size: number, id: string): Fl0wMessage => ({
      message: {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: id,
          toolName: 'default/read_file',
          output: { type: 'text', value: 'x'.repeat(size) },
        }],
      },
    });
    const messages: Fl0wMessage[] = [
      { message: { role: 'user', content: 'compare files' } },
      payload(80_000, 'old'),
      payload(80_000, 'new'),
    ];
    const tokenLimit = TEST_CONTEXT_WINDOW * COMPACTION_TOKEN_THRESHOLD;

    const shrunk = shrinkMessagesToTokenBudget(messages, tokenLimit);
    const oldValue = shrunk[1]?.message.role === 'tool' && Array.isArray(shrunk[1].message.content)
      && shrunk[1].message.content[0]?.type === 'tool-result' && 'value' in shrunk[1].message.content[0].output
      ? String(shrunk[1].message.content[0].output.value)
      : '';
    const newValue = shrunk[2]?.message.role === 'tool' && Array.isArray(shrunk[2].message.content)
      && shrunk[2].message.content[0]?.type === 'tool-result' && 'value' in shrunk[2].message.content[0].output
      ? String(shrunk[2].message.content[0].output.value)
      : '';

    expect(oldValue.length).toBeLessThan(80_000);
    expect(newValue.length).toBeGreaterThan(oldValue.length);
  });

  test('normalizes truncated json and content tool outputs to plain text', () => {
    const tokenLimit = 500;
    const jsonMessage: Fl0wMessage = {
      message: {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'json',
          toolName: 'default/bash',
          output: { type: 'json', value: { stdout: 'x'.repeat(20_000) } },
        }],
      },
    };
    const contentMessage: Fl0wMessage = {
      message: {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'content',
          toolName: 'provider/tool',
          output: {
            type: 'content',
            value: [{ type: 'text', text: 'y'.repeat(20_000) }],
          },
        }],
      },
    };

    const shrunk = shrinkMessagesToTokenBudget([jsonMessage, contentMessage], tokenLimit);

    for (const entry of shrunk) {
      const part = entry.message.role === 'tool' && Array.isArray(entry.message.content)
        ? entry.message.content[0]
        : undefined;
      expect(part?.type).toBe('tool-result');
      if (part?.type !== 'tool-result') continue;
      expect(part.output.type).toBe('text');
      if (part.output.type !== 'text') continue;
      expect(typeof part.output.value).toBe('string');
      expect(() => mapToolResultOutput({ output: part.output, downloadedAssets: {} })).not.toThrow();
    }
  });
});
