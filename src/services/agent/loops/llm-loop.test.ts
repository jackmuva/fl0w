import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Fl0wMessage } from '../../../models/agent';
import { fl0wMessage } from '../utils/fl0w-message';
import { getSessionUsageState, resetSessionUsage } from '../hooks/session-usage';
import { resetLlmStreamText, setLlmStreamText } from './llm-loop';
import { fl0wLoop, resolveAgentMode } from '../main-loop';
import { ASK_QUESTION_ACTION, CREATE_PLAN_ACTION } from '../utils/tools';
import { findPendingAskQuestion } from '../utils/ask-question-state';

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };

const streamText = mock((): unknown => {
  throw new Error('streamText mock not configured');
});

/** Shapes a completed turn like a `streamText` result, emitting the text as two deltas. */
const streamed = <T extends { text: string }>(turn: T) => ({
  ...turn,
  fullStream: (async function* () {
    const mid = Math.ceil(turn.text.length / 2);
    for (const text of [turn.text.slice(0, mid), turn.text.slice(mid)]) {
      if (text) yield { type: 'text-delta', id: 't', text };
    }
  })(),
});

const textTurn = (text: string) => streamed({
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
) => streamed({
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
  streamText.mockReset();
  setLlmStreamText(streamText as never);
});

afterEach(() => {
  resetLlmStreamText();
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
    streamText.mockImplementation(() => textTurn('Here is the answer.'));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const last = run.messages.at(-1)?.message;
    expect(last).toEqual({ role: 'assistant', content: 'Here is the answer.' });
    expect(getSessionUsageState().sessionTokensUsed).toBeGreaterThan(0);
    expect(getSessionUsageState().sessionCostUsd).toBeGreaterThan(0);
  });

  test('streams text deltas to onStreamText and clears them on commit', async () => {
    streamText.mockImplementation(() => textTurn('Streaming answer'));
    const run = collected();
    const updates: Array<string | null> = [];

    const outcome = await fl0wLoop(seed, run.callback, undefined, {
      mode: 'llm',
      onStreamText: (text) => updates.push(text),
    });

    expect(outcome).toBe('ok');
    expect(updates).toEqual(['Streamin', 'Streaming answer', null]);
    expect(run.messages.at(-1)?.message).toEqual({ role: 'assistant', content: 'Streaming answer' });
  });

  test('executes a tool call then completes on text', async () => {
    streamText
      .mockImplementationOnce(() => toolTurn('default/message_answer', { answer: 'from the tool' }))
      .mockImplementationOnce(() => textTurn('All done.'));
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
    streamText
      .mockImplementationOnce(() => toolTurn(CREATE_PLAN_ACTION, { plan: '1. inspect\n2. edit' }))
      .mockImplementationOnce(() => textTurn('Plan captured.'));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('ok');
    const toolResult = run.messages.find(({ message }) => message.role === 'tool')?.message;
    expect(toolResult?.role).toBe('tool');
    if (toolResult?.role === 'tool' && Array.isArray(toolResult.content)) {
      const part = toolResult.content[0];
      expect(part?.type).toBe('tool-result');
      if (part?.type === 'tool-result') {
        expect(part.toolName).toBe(CREATE_PLAN_ACTION);
        if ('value' in part.output) expect(part.output.value).toBe('1. inspect\n2. edit');
      }
    }
  });

  test('pauses when the model calls AskQuestion', async () => {
    streamText.mockImplementation(() => toolTurn(ASK_QUESTION_ACTION, {
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
    streamText.mockImplementation(() => textTurn('should not run'));
    const run = collected();
    const abort = new AbortController();
    abort.abort();

    const outcome = await fl0wLoop(seed, run.callback, abort.signal, { mode: 'llm' });

    expect(outcome).toBe('stopped');
    expect(run.messages.at(-1)?.message).toEqual({ role: 'assistant', content: 'Run stopped.' });
    expect(streamText).not.toHaveBeenCalled();
  });

  test('surfaces an error part from the stream', async () => {
    streamText.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: 'error', error: new Error('stream broke') };
      })(),
    }));
    const run = collected();

    const outcome = await fl0wLoop(seed, run.callback, undefined, { mode: 'llm' });

    expect(outcome).toBe('error');
    const last = run.messages.at(-1)?.message;
    expect(typeof last?.content === 'string' && last.content.includes('stream broke')).toBe(true);
  });

  test('surfaces an error after a failed generate retry', async () => {
    streamText.mockImplementation(() => {
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
