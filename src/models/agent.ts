import type { ModelMessage } from "ai";

export type ChoiceProbabilities = { [choice: string]: number };

export type Fl0wMessageFrame = 'summary' | 'decision';

/** A ModelMessage plus UI-only metadata. Only non-framed messages go to the LLM (see `toModelMessages`). */
export type Fl0wMessage = {
  message: ModelMessage,
  frame?: Fl0wMessageFrame,
}

export type STATE = "START" | "DISCOVERY" | "PLAN" | "EXECUTE" | "REWIND" | "END";
export type AgentState = {
  state: STATE,
  messages: Fl0wMessage[],
  selectedTool?: string,
  /** Action-select (or routing) probabilities for the upcoming tool call. */
  probabilities?: ChoiceProbabilities,
}

export type UserToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

export type CapabilityKind = 'skills' | 'mcpServers' | 'userTools' | 'agentsMd';

export type CapabilitySelection = Record<CapabilityKind, string[]>;

export type CapabilityCatalog = Record<CapabilityKind, Array<{ name: string, description?: string }>>;
