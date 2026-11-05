import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import { MAX_PARALLEL_SUBAGENTS } from '../../../constants';
import { modelStore } from '../../../store/model-store';
import { runContextStore } from '../../../store/run-context-store';
import { executeSubagent } from './subagent';

const MODEL = 'mock/subagent';

let active = 0;
let peak = 0;

// Each child call holds the model "busy" for a while so overlapping runs are observable.
const slowModel = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    const last = prompt.at(-1);
    const task = last?.role === 'user' && last.content[0]?.type === 'text' ? last.content[0].text : '';
    const parts: LanguageModelV4StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: `done: ${task}` },
      { type: 'text-end', id: 't' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
      },
    ];
    return {
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          active += 1;
          peak = Math.max(peak, active);
          await Bun.sleep(400); // longer than modelRateLimiter's 100ms minTime stagger
          for (const part of parts) controller.enqueue(part);
          active -= 1;
          controller.close();
        },
      }),
    };
  },
});

describe('executeSubagent', () => {
  let previousProvider: unknown;

  beforeEach(() => {
    active = 0;
    peak = 0;
    previousProvider = globalThis.AI_SDK_DEFAULT_PROVIDER;
    globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({ languageModels: { [MODEL]: slowModel } });
    spyOn(modelStore, 'contextWindowFor').mockResolvedValue(1_000_000);
    runContextStore.set({ model: MODEL, reasoning: 'low' });
  });

  afterEach(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previousProvider as typeof globalThis.AI_SDK_DEFAULT_PROVIDER;
    runContextStore.clear();
  });

  test('throws outside an agent run', async () => {
    runContextStore.clear();
    expect(executeSubagent({ description: 'x', prompt: 'x' })).rejects.toThrow('during an agent run');
  });

  test('returns the child agent final report', async () => {
    expect(await executeSubagent({ description: 'echo', prompt: 'task A' })).toBe('done: task A');
  });

  test('runs sub-agents in parallel, capped at MAX_PARALLEL_SUBAGENTS', async () => {
    const count = MAX_PARALLEL_SUBAGENTS + 2;
    const reports = await Promise.all(
      Array.from({ length: count }, (_, i) => executeSubagent({ description: `task ${i}`, prompt: `task ${i}` })),
    );
    expect(reports).toEqual(Array.from({ length: count }, (_, i) => `done: task ${i}`));
    expect(peak).toBe(MAX_PARALLEL_SUBAGENTS);
  });

  test('stops when the parent run is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(executeSubagent({ description: 'x', prompt: 'x' }, { abortSignal: controller.signal })).rejects.toThrow();
  });
});
