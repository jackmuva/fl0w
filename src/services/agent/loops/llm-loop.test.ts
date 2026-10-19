import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Fl0wMessage } from '../../../models/agent';
import { fl0wMessage } from '../utils/fl0w-message';
import { getSessionUsageState, resetSessionUsage } from '../hooks/session-usage';
import { resetLlmGenerateText, setLlmGenerateText } from './llm-loop';
import { fl0wLoop, resolveAgentMode } from '../main-loop';
import { findPendingAskQuestion } from '../utils/ask-question-state';

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };

const generateText = mock(async (): Promise<unknown> => {
  throw new Error('generateText mock not configured');
});

const textTurn = (text: string) => ({
  text,
  toolCalls: [] as const,
  usage,
  providerMetadata: { gateway: { cost: 0.01 } },
});

const toolTurn = (
  toolName: string,
  input: unknown,
  toolCallId = 'call-1',
  extra: { invalid?: boolean; error?: Error; text?: string } = {},
) => ({
  text: extra.text ?? '',
  toolCalls: [{
    toolCallId,
    toolName,
    input,
    invalid: extra.invalid,
    error: extra.error,
  }],
  usage,
  providerMetadata: { gateway: { cost: 0.02 } },
});

type Run = {
  messages: Fl0wMessage[];
  callback: (next: Fl0wMessage[]) => void;
};

const collected = (): Run => {
  const run: Run = {
    messages: [],
    callback: (next) => { run.messages = next; },
  };
  return run;
};

beforeEach(() => {
  resetSessionUsage();
  generateText.mockReset();
  setLlmGenerateText(generateText as never);
});

afterEach(() => {
  resetLlmGenerateText();
  resetSessionUsage();
});

describe('resolveAgentMode', () => {
  test('honors an explicit mode override', () => {
    expect(resolveAgentMode({ mode: 'llm' })).toBe('llm');
    expect(resolveAgentMode({ mode: 'decision' })).toBe('decision');
  });
});

describe('fl0wLoop llm mode', () => {
  const seed = [fl0wMessage({ role: 'user', content: 'hello' })];

  test('ends on a final text response and records usage', async () => {
    generateText.mockImplementation(async () => textTurn('Here is the answer.'));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const last = run.messages.at(-1)?.message;
    expect(last).toEqual({ role: 'assistant', content: 'Here is the answer.' });
    expect(getSessionUsageState().sessionTokensUsed).toBeGreaterThan(0);
    expect(getSessionUsageState().sessionCostUsd).toBeGreaterThan(0);
  });

  test('executes a tool call then completes on text', async () => {
    generateText
      .mockImplementationOnce(async () => toolTurn('default/message_answer', { answer: 'from the tool' }))
      .mockImplementationOnce(async () => textTurn('All done.'));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const roles = run.messages.map(({ message }) => message.role);
    expect(roles).toContain('tool');
    expect(run.messages.at(-1)?.message).toEqual({ role: 'assistant', content: 'All done.' });

    const toolResult = run.messages.find(({ message }) => message.role === 'tool')?.message;
    expect(toolResult?.role).toBe('tool');
    if (toolResult?.role === 'tool' && Array.isArray(toolResult.content)) {
      const part = toolResult.content[0];
      expect(part?.type).toBe('tool-result');
      if (part?.type === 'tool-result' && 'value' in part.output) {
        expect(part.output.value).toBe('from the tool');
      }
    }
  });

  test('records a CreatePlan tool result without a separate executor', async () => {
    generateText
      .mockImplementationOnce(async () => toolTurn('CreatePlan', { plan: '1. inspect\n2. edit' }))
      .mockImplementationOnce(async () => textTurn('Plan captured.'));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const toolResult = run.messages.find(({ message }) => message.role === 'tool')?.message;
    expect(toolResult?.role).toBe('tool');
    if (toolResult?.role === 'tool' && Array.isArray(toolResult.content)) {
      const part = toolResult.content[0];
      expect(part?.type).toBe('tool-result');
      if (part?.type === 'tool-result') {
        expect(part.toolName).toBe('CreatePlan');
        if ('value' in part.output) expect(part.output.value).toBe('1. inspect\n2. edit');
      }
    }
  });

  test('pauses when the model calls AskQuestion', async () => {
    generateText.mockImplementation(async () => toolTurn('AskQuestion', {
      questions: [{
        id: 'q1',
        question: 'Which file?',
        options: [{ id: 'a', label: 'A' }, { id: 'other', label: 'Other' }],
      }],
    }));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const pending = findPendingAskQuestion(run.messages);
    expect(pending?.toolCallId).toBe('call-1');
    expect(run.messages.some(({ message }) => message.role === 'tool')).toBe(false);
  });

  test('returns stopped when the abort signal is already aborted', async () => {
    generateText.mockImplementation(async () => textTurn('should not run'));
    const run = collected();
    const abort = new AbortController();
    abort.abort();

    const outcome = await fl0wLoop(seed, run.callback, abort.signal, { mode: 'llm' });

    expect(outcome).toBe('stopped');
    expect(run.messages.at(-1)?.message).toEqual({ role: 'assistant', content: 'Run stopped.' });
    expect(generateText).not.toHaveBeenCalled();
  });

  test('surfaces an error after a failed generate retry', async () => {
    generateText.mockImplementation(async () => {
      throw new Error('boom');
    });
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('error');
    const last = run.messages.at(-1)?.message;
    expect(last?.role).toBe('assistant');
    expect(typeof last?.content === 'string' && last.content.includes('boom')).toBe(true);
  });
});
