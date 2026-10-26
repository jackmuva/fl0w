import { afterEach, describe, expect, test } from 'bun:test';
import { sessionUsageStore } from './session-usage-store';

describe('session usage store', () => {
  afterEach(() => {
    sessionUsageStore.reset();
  });

  test('tracks cost and last input tokens for main-agent calls', () => {
    sessionUsageStore.record({
      providerMetadata: { gateway: { cost: '0.002' } },
      usage: { inputTokens: 8000, outputTokens: 200, totalTokens: 8200 },
    }, 100_000);
    sessionUsageStore.record({
      providerMetadata: { gateway: { cost: '0.001' } },
      usage: { inputTokens: 12000, outputTokens: 100, totalTokens: 12100 },
    }, 200_000);

    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 0.003,
      lastInputTokens: 12000,
      contextWindow: 200_000,
    });
  });

  test('side calls without a context window leave context usage alone', () => {
    sessionUsageStore.record({ usage: { inputTokens: 5000, totalTokens: 5100 } }, 100_000);
    sessionUsageStore.record({ usage: { inputTokens: 90000, totalTokens: 90500 } });

    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 5000,
      contextWindow: 100_000,
    });
  });

  test('reset clears state', () => {
    sessionUsageStore.record({ usage: { inputTokens: 100, totalTokens: 150 } }, 32_000);
    sessionUsageStore.reset();
    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 0,
      contextWindow: 0,
    });
  });
});
