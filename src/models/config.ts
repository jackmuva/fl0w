export type AppConfig = {
  aiGatewayApiKey?: string;
  /** Context window (tokens) for compaction thresholds and UI usage meter (default 1_000_000). */
  contextWindow?: number;
  decisionModel?: string;
  llmModel?: string;
  /** Sync config files with fl0w-work when signed in (default true). Per device; never synced itself. */
  sync?: boolean;
};
