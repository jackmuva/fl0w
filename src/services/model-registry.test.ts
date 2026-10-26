import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_CONTEXT_WINDOW } from '../constants';

const listModels = mock(async () => [
  { model: 'test/model', contextWindow: 32_000, inputTokenPrice: 0.1, type: 'text' as const },
]);
mock.module('./remote-api/ai-api', () => ({ listModels }));

const { contextWindowFor, loadModels } = await import('./model-registry');

describe('model registry', () => {
  test('looks up context windows and falls back for unknown models', async () => {
    expect(await contextWindowFor('test/model')).toBe(32_000);
    expect(await contextWindowFor('unknown/model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  test('fetches models only once', async () => {
    await loadModels();
    await loadModels();
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
