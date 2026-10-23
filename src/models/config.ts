export type AgentMode = 'decision' | 'llm';

export type AppConfig = {
  contextWindow?: number;
  decisionModel?: string;
  llmModel?: string;
  mode?: AgentMode;
  toolOutputMaxChars?: number;
  maxIterations?: number;
  sync?: boolean;
};
