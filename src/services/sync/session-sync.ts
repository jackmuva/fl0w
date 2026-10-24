import { SessionStore } from '../../db/session-store';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../setup';
import { deleteRemoteSession, getRemoteSession, listRemoteSessions, pushSession } from '../remote-api/sync-api';

const PUSH_DEBOUNCE_MS = 2_000;

let queue: Promise<unknown> = Promise.resolve();
let pendingPush: { timer: ReturnType<typeof setTimeout>, store?: SessionStore } | null = null;

export type SessionSyncResult = { pushed: number, pulled: number };

/**
 * Two-way sync keyed on `updatedAt` (last writer wins per session): pushes sessions that are newer here or
 * missing on fl0w-work, then pulls ones that are newer there or missing here.
 * Returns null when not signed in or `sync: false` is set in config.json.
 */
export async function syncSessions(store?: SessionStore): Promise<SessionSyncResult | null> {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const local = store ?? SessionStore.open();
    const toPull = new Map((await listRemoteSessions()).map((s) => [s.id, s.updatedAt]));
    const result: SessionSyncResult = { pushed: 0, pulled: 0 };

    for (const session of local.listAllSessions()) {
      const remoteUpdatedAt = toPull.get(session.id);
      if (remoteUpdatedAt !== undefined && remoteUpdatedAt > session.updatedAt) continue;
      toPull.delete(session.id);
      if (remoteUpdatedAt === session.updatedAt) continue;
      const messages = local.loadMessages(session.id);
      if (messages.length && await pushSession({ ...session, messages })) result.pushed++;
    }

    for (const id of toPull.keys()) {
      const session = await getRemoteSession(id);
      if (!session) continue;
      local.importSession(session);
      result.pulled++;
    }
    return result;
  });
  queue = run.catch(() => { });
  return run;
}

export function syncSessionsInBackground(store?: SessionStore): void {
  void syncSessions(store).catch(() => null);
}

export function scheduleSessionPush(store?: SessionStore): void {
  if (pendingPush) clearTimeout(pendingPush.timer);
  pendingPush = {
    store,
    timer: setTimeout(() => {
      pendingPush = null;
      syncSessionsInBackground(store);
    }, PUSH_DEBOUNCE_MS),
  };
}

/** Queued behind in-flight syncs so a later sync can't pull the session back before it's gone remotely. */
export function deleteRemoteSessionInBackground(id: string): void {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return;
    await deleteRemoteSession(id);
  });
  queue = run.catch(() => { });
}

export async function flushSessionPushes(): Promise<void> {
  if (pendingPush) {
    clearTimeout(pendingPush.timer);
    syncSessionsInBackground(pendingPush.store);
    pendingPush = null;
  }
  await queue;
}
