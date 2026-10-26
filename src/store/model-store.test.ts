import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_CONTEXT_WINDOW } from '../constants';

const listModels = mock(async () => [
  { model: 'test/model', contextWindow: 32_000, inputTokenPrice: 0.1, type: 'text' as const },
]);
mock.module('../services/remote-api/ai-api', () => ({ listModels }));

const { modelStore } = await import('./model-store');

describe('model store', () => {
  test('looks up context windows and falls back for unknown models', async () => {
    expect(await modelStore.contextWindowFor('test/model')).toBe(32_000);
    expect(await modelStore.contextWindowFor('unknown/model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  test('fetches models only once', async () => {
    await modelStore.loadModels();
    await modelStore.loadModels();
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
