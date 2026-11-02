import type { ProviderMetadata } from 'ai';
import type { SessionStats } from '../models/session';

const MICRO_USD_PER_USD = 1_000_000;

export type SessionUsageState = {
  sessionCostUsd: number;
  lastInputTokens: number;
  contextWindow: number;
  totalTokens: number;
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
  private totalTokens = 0;
  private readonly listeners = new Set<() => void>();

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get(): SessionUsageState {
    return {
      sessionCostUsd: this.sessionCostUsd,
      lastInputTokens: this.lastInputTokens,
      contextWindow: this.contextWindow,
      totalTokens: this.totalTokens,
    };
  }

  reset(): void {
    this.restore(undefined);
  }

  /**
   * Starts from a stored session's stats so new calls add to them. The context window is unknown until the model
   * list loads; pass it to `fillContextWindow` once it does.
   */
  restore(stats: Partial<SessionStats> | undefined): void {
    this.sessionCostUsd = (stats?.spend ?? 0) / MICRO_USD_PER_USD;
    this.lastInputTokens = stats?.lastInputTokens ?? 0;
    this.contextWindow = 0;
    this.totalTokens = stats?.totalTokens ?? 0;
    this.notify();
  }

  /** Sets the window for restored input tokens; no-op once a live call has set its own. */
  fillContextWindow(window: number): void {
    if (this.contextWindow > 0 || this.lastInputTokens <= 0 || window <= 0) return;
    this.contextWindow = window;
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
    const tokens = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    if (tokens > 0) {
      this.totalTokens += tokens;
      changed = true;
    }

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
