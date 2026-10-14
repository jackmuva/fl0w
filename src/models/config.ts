export type AppConfig = {
  aiGatewayApiKey?: string;
  llmModel?: string;
  /** Sync config files with fl0w-work when signed in (default true). Per device; never synced itself. */
  sync?: boolean;
};
