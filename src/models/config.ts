export type AgentMode = 'decision' | 'llm';

export type AppConfig = {
  /** Context window (tokens) for compaction thresholds and UI usage meter (default 1_000_000). */
  contextWindow?: number;
  decisionModel?: string;
  llmModel?: string;
  mode?: AgentMode;
  /** Max chars per tool result before it is truncated and spilled to the session workspace (default 20_000). */
  toolOutputMaxChars?: number;
  /** Sync config files with fl0w-work when signed in (default true). Per device; never synced itself. */
  sync?: boolean;
};
