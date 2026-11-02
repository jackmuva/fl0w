import type { CapabilitySelection, Fl0wMessage } from './agent';
import type { ModelSelection } from './agent';

export type SessionRecord = {
  id: string;
  workspacePath: string;
  title: string | null;
  models: ModelSelection | null;
  capabilities: CapabilitySelection | null;
  createdAt: string;
  updatedAt: string;
};

/** One row of GET /api/sync/sessions. */
export type SessionListEntry = SessionRecord & { messageCount: number };

/**
 * Usage fl0w-work accumulates for a session as its model calls are billed (`spend` in micro-USD). Read-only for the
 * CLI: GET returns it, PUT ignores it.
 */
export type SessionStats = { spend: number | null; lastInputTokens: number | null; totalTokens: number | null };

/** A session with its messages in order, as GET/PUT /api/sync/sessions/:id carry it; GET adds its stats. */
export type StoredSession = SessionRecord & { messages: Fl0wMessage[] } & Partial<SessionStats>;
