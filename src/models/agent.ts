import type { ModelMessage } from "ai";

export type ChoiceProbabilities = { [choice: string]: number };

export type Fl0wMessageFrame = 'summary' | 'decision';

export type Fl0wMessage = {
  message: ModelMessage,
  frame?: Fl0wMessageFrame,
}

export type STATE = "START" | "DISCOVERY" | "PLAN" | "EXECUTE" | "REWIND" | "END";
export type AgentState = {
  state: STATE,
  messages: Fl0wMessage[],
  selectedTool?: string,
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

export type CliOuputStatus = 'ok' | 'error' | 'stopped' | 'needs_input';

export type CliOutputPendingQuestion = {
  toolCallId: string;
  input: {
    title?: string;
    questions: Array<{
      id: string;
      prompt?: string;
      question?: string;
      options: Array<{ id: string; label: string }>;
      allow_multiple?: boolean;
    }>;
  };
};

/**
 * JSON lines written to stdout by headless `fl0w session` and `fl0w workflow`. `snapshot` replaces the whole
 * transcript; `message` sets the entry at `index` (always the next position after the latest snapshot/appends).
 * `mcp_auth_required` reports an MCP server whose OAuth credentials need the user to authorize again (in fl0w-work).
 */
export type CliOutput =
  | { type: 'snapshot'; messages: Fl0wMessage[] }
  | { type: 'message'; index: number; message: Fl0wMessage }
  | { type: 'mcp_auth_required'; server: string; serverUrl: string }
  | {
      type: 'result';
      status: CliOuputStatus;
      sessionId: string;
      pendingQuestion?: CliOutputPendingQuestion;
    };
