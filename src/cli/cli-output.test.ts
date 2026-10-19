import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { CliOutput } from '../models/agent';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { createTranscriptPrinter } from './cli-output';

describe('createTranscriptPrinter', () => {
  let lines: CliOutput[];
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lines = [];
    logSpy = spyOn(console, 'log').mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  });
  afterEach(() => logSpy.mockRestore());

  const system = fl0wMessage({ role: 'system', content: 'rules' });
  const user = fl0wMessage({ role: 'user', content: 'hi' });
  const decision = fl0wMessage({ role: 'assistant', content: '{}' }, 'decision');
  const reply = fl0wMessage({ role: 'assistant', content: 'hello' });

  test('snapshots first, then appends with indices that skip system messages', () => {
    const print = createTranscriptPrinter();
    print([system, user]);
    print([system, user, decision]);
    print([system, user, decision, reply]);

    expect(lines).toEqual([
      { type: 'snapshot', messages: [user] },
      { type: 'message', index: 1, message: decision },
      { type: 'message', index: 2, message: reply },
    ]);
  });

  test('re-snapshots when entries shrink or are rewritten in place', () => {
    const print = createTranscriptPrinter();
    print([user, decision, reply]);
    const summary = fl0wMessage({ role: 'assistant', content: 'condensed' }, 'summary');
    print([user, summary]);
    const truncated = { ...user, message: { role: 'user' as const, content: 'h' } };
    print([truncated, summary]);
    print([truncated, summary]);

    expect(lines.map((line) => line.type)).toEqual(['snapshot', 'snapshot', 'snapshot']);
    expect(lines[2]).toEqual({ type: 'snapshot', messages: [truncated, summary] });
  });
});
