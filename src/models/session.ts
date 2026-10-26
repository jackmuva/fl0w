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

/** A session with its messages in order, as GET/PUT /api/sync/sessions/:id carry it. */
export type StoredSession = SessionRecord & { messages: Fl0wMessage[] };
