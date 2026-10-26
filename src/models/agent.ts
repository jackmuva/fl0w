import type { ModelMessage } from "ai";

export type SubagentType = 'SUMMARY' | "ROUTING" | "EXECUTE" | "PLAN" | "DISCOVERY";

export type Fl0wMessage = {
  message: ModelMessage,
  subagent?: SubagentType,
}

export type UserToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

export type StateModel = {
  "DISCOVERY": string,
  "PLAN": string,
  "EXECUTE": string,
}

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
 * `stream_delta` appends to a live preview of the assistant text being generated, and `stream_end` discards it; the
 * preview is never part of the transcript (the finished text arrives as a `message`), so replays can skip both.
 * `phase` reports the subagent now running (`null` once the loop ends), the TUI's active phase; like the stream lines
 * it's live-only and not part of the transcript.
 * `mcp_auth_required` reports an MCP server whose OAuth credentials need the user to authorize again (in fl0w-work).
 * `usage` reports the TUI's status bar: the latest call's context use and the cost so far, cumulative for the process,
 * so a replay just overwrites it; it's live-only too.
 */
export type CliOutput =
  | { type: 'snapshot'; messages: Fl0wMessage[] }
  | { type: 'message'; index: number; message: Fl0wMessage }
  | { type: 'stream_delta'; delta: string }
  | { type: 'stream_end' }
  | { type: 'phase'; subagent: SubagentType | null }
  | { type: 'mcp_auth_required'; server: string; serverUrl: string }
  | { type: 'usage'; contextPercent: number; inputTokens: number; sessionCostUsd: number }
  | {
    type: 'result';
    status: CliOuputStatus;
    sessionId: string;
    pendingQuestion?: CliOutputPendingQuestion;
  };

export type ModelMetadata = {
  model: string,
  contextWindow: number,
  /** USD per 1M input tokens */
  inputTokenPrice: number,
  type: "text" | "decision",
}

export type ModelSelection = {
  "ROUTER": string,
  "DISCOVERY": string,
  "PLAN": string,
  "EXECUTE": string,
  "SUMMARIZE": string,
}
