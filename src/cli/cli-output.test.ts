import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { CliOutput } from '../models/agent';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { createPhasePrinter, createStreamPrinter, createTranscriptPrinter } from './cli-output';

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
  const decision = fl0wMessage({ role: 'assistant', content: '{}' }, 'ROUTING');
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
    const summary = fl0wMessage({ role: 'assistant', content: 'condensed' }, 'SUMMARY');
    print([user, summary]);
    const truncated = { ...user, message: { role: 'user' as const, content: 'h' } };
    print([truncated, summary]);
    print([truncated, summary]);

    expect(lines.map((line) => line.type)).toEqual(['snapshot', 'snapshot', 'snapshot']);
    expect(lines[2]).toEqual({ type: 'snapshot', messages: [truncated, summary] });
  });
});

describe('createStreamPrinter', () => {
  let lines: CliOutput[];
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lines = [];
    logSpy = spyOn(console, 'log').mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  });
  afterEach(() => logSpy.mockRestore());

  test('prints only new text, ends on commit, and restarts when the preview diverges', () => {
    const print = createStreamPrinter();
    print('Hel');
    print('Hello');
    print('Hello');
    print(null);
    print(null);
    print('Retry');
    print('Other');

    expect(lines).toEqual([
      { type: 'stream_delta', delta: 'Hel' },
      { type: 'stream_delta', delta: 'lo' },
      { type: 'stream_end' },
      { type: 'stream_delta', delta: 'Retry' },
      { type: 'stream_end' },
      { type: 'stream_delta', delta: 'Other' },
    ]);
  });
});

describe('createPhasePrinter', () => {
  let lines: CliOutput[];
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lines = [];
    logSpy = spyOn(console, 'log').mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  });
  afterEach(() => logSpy.mockRestore());

  test('prints each phase change once and null when the loop ends', () => {
    const print = createPhasePrinter();
    print(null);
    print('PLAN');
    print('PLAN');
    print('EXECUTE');
    print(null);

    expect(lines).toEqual([
      { type: 'phase', subagent: 'PLAN' },
      { type: 'phase', subagent: 'EXECUTE' },
      { type: 'phase', subagent: null },
    ]);
  });
});
