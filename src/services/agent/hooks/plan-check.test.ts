import { describe, expect, test } from 'bun:test';
import type { Fl0wMessage } from '../../../models/agent';
import { DEFAULT_CREATE_PLAN_TOOL, DEFAULT_MARK_STEP_COMPLETE_TOOL } from '../default-tools/tool-utils';
import { planCheckHook } from './plan-check';

const toolCall = (toolName: string, input: unknown, toolCallId = crypto.randomUUID()): Fl0wMessage => ({
  message: { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName, input }] },
});

const plan = (...descriptions: string[]): Fl0wMessage =>
  toolCall(DEFAULT_CREATE_PLAN_TOOL, { steps: descriptions.map((description, i) => ({ index: i + 1, description })) });

const mark = (index: number): Fl0wMessage => toolCall(DEFAULT_MARK_STEP_COMPLETE_TOOL, { index });

describe('planCheckHook', () => {
  test('returns nothing without a plan', () => {
    expect(planCheckHook([{ message: { role: 'user', content: 'hi' } }])).toBeUndefined();
  });

  test('returns nothing when every step is marked complete', () => {
    expect(planCheckHook([plan('a', 'b'), mark(1), mark(2)])).toBeUndefined();
  });

  test('lists only the unmarked steps', () => {
    const reminder = planCheckHook([plan('read file', 'edit file', 'run tests'), mark(2)]);
    expect(reminder?.message.role).toBe('user');
    expect(reminder?.subagent).toBe('EXECUTE');
    const content = String(reminder?.message.content);
    expect(content).toContain('1. read file');
    expect(content).toContain('3. run tests');
    expect(content).not.toContain('2. edit file');
  });

  test('only counts marks made after the latest plan', () => {
    const content = String(planCheckHook([plan('old'), mark(1), plan('new one', 'new two'), mark(2)])?.message.content);
    expect(content).toContain('1. new one');
    expect(content).not.toContain('2. new two');
  });
});
