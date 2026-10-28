import type { ProviderMetadata } from 'ai';

export type SessionUsageState = {
  sessionCostUsd: number;
  lastInputTokens: number;
  contextWindow: number;
};

export const contextPercentOf = ({ lastInputTokens, contextWindow }: SessionUsageState): number =>
  lastInputTokens <= 0 || contextWindow <= 0
    ? 0
    : Math.min(100, Math.round((lastInputTokens / contextWindow) * 1000) / 10);

type LlmUsageSource = {
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  };
  providerMetadata?: ProviderMetadata;
};

class SessionUsageStore {
  private sessionCostUsd = 0;
  private lastInputTokens = 0;
  private contextWindow = 0;
  private readonly listeners = new Set<() => void>();

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get(): SessionUsageState {
    return {
      sessionCostUsd: this.sessionCostUsd,
      lastInputTokens: this.lastInputTokens,
      contextWindow: this.contextWindow,
    };
  }

  reset(): void {
    this.sessionCostUsd = 0;
    this.lastInputTokens = 0;
    this.contextWindow = 0;
    this.notify();
  }

  record(source: LlmUsageSource, window?: number): void {
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
        this.sessionCostUsd += cost;
        changed = true;
      }
    }

    const usage = source.usage;
    if (window != null && usage?.inputTokens != null && usage.inputTokens > 0) {
      this.lastInputTokens = usage.inputTokens;
      this.contextWindow = window;
      changed = true;
    }

    if (changed) this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const sessionUsageStore = new SessionUsageStore();
