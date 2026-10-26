import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionWorkspacePath } from '../constants';
import type { Fl0wMessage } from '../models/agent';
import type { SessionListEntry, SessionRecord, StoredSession } from '../models/session';
import { getRemoteSession, listRemoteSessions } from '../services/remote-api/sync-api';
import { outboxStore } from '../services/sync/outbox';
import { deriveTitle, nextUpdatedAt } from '../services/session-record';

/** Saves and deletes not yet pushed, so reads see this device's latest writes. */
const pendingSessions = () => {
  const saved = new Map<string, StoredSession>();
  const deleted = new Set<string>();
  for (const op of outboxStore.pendingOps()) {
    if (op.kind === 'session') saved.set(op.session.id, op.session);
    else if (op.kind === 'delete-session') deleted.add(op.id);
  }
  return { saved, deleted };
};

const toListEntry = ({ messages, ...session }: StoredSession): SessionListEntry =>
  ({ ...session, messageCount: messages.length });

/** The workspace's sessions on fl0w-work plus unpushed saves, newest first. */
export async function listSessions(workspacePath: string): Promise<SessionListEntry[]> {
  const workspace = resolve(workspacePath);
  const byId = new Map((await listRemoteSessions(workspace)).map((session) => [session.id, session]));
  const { saved, deleted } = pendingSessions();
  for (const session of saved.values()) {
    const remote = byId.get(session.id);
    if (session.workspacePath === workspace && (!remote || session.updatedAt > remote.updatedAt)) {
      byId.set(session.id, toListEntry(session));
    }
  }
  return [...byId.values()]
    .filter(({ id }) => !deleted.has(id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The newer of fl0w-work's copy and an unpushed save; an unpushed save alone when fl0w-work can't be reached. */
export async function getSession(id: string): Promise<StoredSession | null> {
  const { saved, deleted } = pendingSessions();
  if (deleted.has(id)) return null;
  const pending = saved.get(id);
  const remote = await getRemoteSession(id).catch((error: unknown) => {
    if (pending) return null;
    throw error;
  });
  if (!remote || !pending) return remote ?? pending ?? null;
  return pending.updatedAt > remote.updatedAt ? pending : remote;
}

export async function findLatestSessionWithMessages(workspacePath: string): Promise<StoredSession | null> {
  const latest = (await listSessions(workspacePath)).find(({ messageCount }) => messageCount > 0);
  return latest ? getSession(latest.id) : null;
}

/**
 * Queues the session for a background push and returns it with its new title and `updatedAt`; pass that record to the
 * next save. A session with no conversation yet isn't pushed.
 */
export function saveSession(session: SessionRecord, messages: Fl0wMessage[]): SessionRecord {
  const conversation = messages.filter(({ message }) => message.role !== 'system');
  const saved: SessionRecord = {
    ...session,
    title: deriveTitle(conversation) ?? session.title,
    updatedAt: nextUpdatedAt(session.updatedAt),
  };
  if (conversation.length > 0) outboxStore.enqueue({ kind: 'session', session: { ...saved, messages: conversation } });
  return saved;
}

/** Queues the delete on fl0w-work and removes the session's local workspace folder. */
export function deleteSession(id: string): void {
  outboxStore.enqueue({ kind: 'delete-session', id });
  if (/^[\w-]+$/.test(id)) rmSync(sessionWorkspacePath(id), { recursive: true, force: true });
}
