import { afterEach, describe, expect, test } from 'bun:test';
import {
  getSessionUsageState,
  recordLlmUsage,
  resetSessionUsage,
} from './session-usage';

describe('session-usage', () => {
  afterEach(() => {
    resetSessionUsage();
  });

  test('tracks cost and last input tokens for main-agent calls', () => {
    recordLlmUsage({
      providerMetadata: { gateway: { cost: '0.002' } },
      usage: { inputTokens: 8000, outputTokens: 200, totalTokens: 8200 },
    }, 100_000);
    recordLlmUsage({
      providerMetadata: { gateway: { cost: '0.001' } },
      usage: { inputTokens: 12000, outputTokens: 100, totalTokens: 12100 },
    }, 200_000);

    expect(getSessionUsageState()).toEqual({
      sessionCostUsd: 0.003,
      lastInputTokens: 12000,
      contextWindow: 200_000,
    });
  });

  test('side calls without a context window leave context usage alone', () => {
    recordLlmUsage({ usage: { inputTokens: 5000, totalTokens: 5100 } }, 100_000);
    recordLlmUsage({ usage: { inputTokens: 90000, totalTokens: 90500 } });

    expect(getSessionUsageState()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 5000,
      contextWindow: 100_000,
    });
  });

  test('reset clears state', () => {
    recordLlmUsage({ usage: { inputTokens: 100, totalTokens: 150 } }, 32_000);
    resetSessionUsage();
    expect(getSessionUsageState()).toEqual({
      sessionCostUsd: 0,
      lastInputTokens: 0,
      contextWindow: 0,
    });
  });
});
