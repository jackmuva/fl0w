import type { ReasoningLevel } from "../services/agent/subagents/reasoning-agent";

export type RunContext = {
  model: string;
  reasoning: ReasoningLevel;
};

/** Model settings for the agent run in progress, for tools (like `subagent`) that start their own model calls. */
class RunContextStore {
  private context: RunContext | null = null;

  get(): RunContext | null {
    return this.context;
  }

  set(context: RunContext): void {
    this.context = context;
  }

  clear(): void {
    this.context = null;
  }
}

export const runContextStore = new RunContextStore();
