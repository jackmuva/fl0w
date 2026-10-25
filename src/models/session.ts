import type { CapabilitySelection, Fl0wMessage } from './agent';
import type { ModelSelection } from './ai-model';

/** A session as fl0w-work stores it, without its messages. */
export type SessionRecord = {
  id: string;
  /** Absolute path of the workspace the session was started in. */
  workspacePath: string;
  title: string | null;
  models: ModelSelection | null;
  capabilities: CapabilitySelection | null;
  createdAt: string;
  updatedAt: string;
};

/** One row of GET /api/sync/sessions. */
export type SessionListEntry = SessionRecord & { messageCount: number };

/** A session with its messages in order, as GET/PUT /api/sync/sessions/:id carry it. */
export type StoredSession = SessionRecord & { messages: Fl0wMessage[] };
