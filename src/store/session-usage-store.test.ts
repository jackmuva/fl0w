import { afterEach, describe, expect, test } from 'bun:test';
import { contextPercentOf, sessionUsageStore } from './session-usage-store';

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
      totalTokens: 20_300,
    });
  });

  test('side calls without a context window leave context usage alone', () => {
    sessionUsageStore.record({ usage: { inputTokens: 5000, totalTokens: 5100 } }, 100_000);
    sessionUsageStore.record({ usage: { inputTokens: 90000, totalTokens: 90500 } });

    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 5000,
      contextWindow: 100_000,
      totalTokens: 95_600,
    });
  });

  test('context percent keeps one decimal so small contexts read above zero', () => {
    expect(contextPercentOf({ sessionCostUsd: 0, lastInputTokens: 3384, contextWindow: 1_000_000, totalTokens: 0 })).toBe(0.3);
    expect(contextPercentOf({ sessionCostUsd: 0, lastInputTokens: 50_000, contextWindow: 200_000, totalTokens: 0 })).toBe(25);
  });

  test('total tokens fall back to input plus output when the provider omits a total', () => {
    sessionUsageStore.record({ usage: { inputTokens: 1000, outputTokens: 50 } });
    expect(sessionUsageStore.get().totalTokens).toBe(1050);
  });

  test('reset clears state', () => {
    sessionUsageStore.record({ usage: { inputTokens: 100, totalTokens: 150 } }, 32_000);
    sessionUsageStore.reset();
    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 0,
      contextWindow: 0,
      totalTokens: 0,
    });
  });

  test('restores stored stats and keeps accumulating from them', () => {
    sessionUsageStore.restore({ spend: 1_250_000, lastInputTokens: 40_000, totalTokens: 90_000 });
    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 1.25,
      lastInputTokens: 40_000,
      contextWindow: 0,
      totalTokens: 90_000,
    });

    sessionUsageStore.fillContextWindow(200_000);
    expect(contextPercentOf(sessionUsageStore.get())).toBe(20);

    sessionUsageStore.record({
      providerMetadata: { gateway: { cost: 0.25 } },
      usage: { inputTokens: 50_000, outputTokens: 500, totalTokens: 50_500 },
    }, 100_000);
    expect(sessionUsageStore.get()).toEqual({
      sessionCostUsd: 1.5,
      lastInputTokens: 50_000,
      contextWindow: 100_000,
      totalTokens: 140_500,
    });

    // a late window lookup doesn't override a live call's window
    sessionUsageStore.fillContextWindow(200_000);
    expect(sessionUsageStore.get().contextWindow).toBe(100_000);
  });

  test('restoring nothing or null stats starts from zero', () => {
    sessionUsageStore.record({ usage: { inputTokens: 10, totalTokens: 20 } }, 1000);
    sessionUsageStore.restore({ spend: null, lastInputTokens: null, totalTokens: null });
    expect(sessionUsageStore.get()).toEqual({ sessionCostUsd: 0, lastInputTokens: 0, contextWindow: 0, totalTokens: 0 });
    sessionUsageStore.fillContextWindow(1000);
    expect(sessionUsageStore.get().contextWindow).toBe(0);
  });
});
