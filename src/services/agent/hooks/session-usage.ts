import type { ProviderMetadata } from 'ai';

export type SessionUsageState = {
  sessionCostUsd: number;
  lastInputTokens: number;
  contextWindow: number;
};

type LlmUsageSource = {
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  };
  providerMetadata?: ProviderMetadata;
};

let sessionCostUsd = 0;
let lastInputTokens = 0;
let contextWindow = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const getSessionUsageState = (): SessionUsageState => ({
  sessionCostUsd,
  lastInputTokens,
  contextWindow,
});

export const resetSessionUsage = (): void => {
  sessionCostUsd = 0;
  lastInputTokens = 0;
  contextWindow = 0;
  notify();
};

// Pass `window` only for main-agent calls: side calls (compaction, tool filtering) see a different
// prompt, so their input tokens would misreport how full the conversation's context is.
export const recordLlmUsage = (source: LlmUsageSource, window?: number): void => {
  let changed = false;

  const gateway = source.providerMetadata?.gateway;
  if (gateway && typeof gateway === 'object') {
    const rawCost = (gateway as Record<string, unknown>).cost;
    const cost = typeof rawCost === 'number'
      ? rawCost
      : typeof rawCost === 'string'
        ? Number.parseFloat(rawCost)
        : NaN;
    if (Number.isFinite(cost) && cost > 0) {
      sessionCostUsd += cost;
      changed = true;
    }
  }

  const usage = source.usage;
  if (window != null && usage?.inputTokens != null && usage.inputTokens > 0) {
    lastInputTokens = usage.inputTokens;
    contextWindow = window;
    changed = true;
  }

  if (changed) notify();
};

export const subscribeSessionUsage = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
