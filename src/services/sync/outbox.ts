import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTBOX_DIR } from '../../constants';
import type { StoredSession } from '../../models/session';
import type { WorkflowRecord } from '../../models/workflow';
import { readFl0wAuth } from '../auth/token';
import { deleteRemoteSession, deleteRemoteWorkflow, pushSession, pushWorkflow } from '../remote-api/sync-api';
import { SyncHttpError } from '../remote-api/utils';

/** A write waiting to reach fl0w-work. A session op carries the whole session, so a newer save replaces an older one. */
export type OutboxOp =
  | { kind: 'session', session: StoredSession }
  | { kind: 'workflow', workflow: WorkflowRecord }
  | { kind: 'delete-session', id: string }
  | { kind: 'delete-workflow', id: string };

const PUSH_DEBOUNCE_MS = 2_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;

let queue: Promise<unknown> = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_MIN_MS;

const opId = (op: OutboxOp): string =>
  op.kind === 'session' ? op.session.id : op.kind === 'workflow' ? op.workflow.id : op.id;

const opPath = (kind: OutboxOp['kind'], id: string): string =>
  join(OUTBOX_DIR, `${kind}-${encodeURIComponent(id)}.json`);

const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const outboxFiles = (): string[] => {
  try {
    return readdirSync(OUTBOX_DIR).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
};

/**
 * Saves the write under ~/.fl0w/outbox (so it survives a crash or being offline) and pushes it in the background once
 * writes settle. A delete drops any pending save of the same session or workflow, and wins over later saves of it.
 */
export function enqueue(op: OutboxOp): void {
  mkdirSync(OUTBOX_DIR, { recursive: true });
  const id = opId(op);
  if (op.kind === 'delete-session') rmSync(opPath('session', id), { force: true });
  if (op.kind === 'delete-workflow') rmSync(opPath('workflow', id), { force: true });
  if (op.kind === 'session' && existsSync(opPath('delete-session', id))) return;
  if (op.kind === 'workflow' && existsSync(opPath('delete-workflow', id))) return;

  const path = opPath(op.kind, id);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(op));
  renameSync(tmp, path);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    drainOutboxInBackground();
  }, PUSH_DEBOUNCE_MS);
  debounceTimer.unref?.();
}

/** Every write not yet pushed, oldest file name first. */
export function pendingOps(): OutboxOp[] {
  const ops: OutboxOp[] = [];
  for (const name of outboxFiles()) {
    const raw = readOrNull(join(OUTBOX_DIR, name));
    if (raw === null) continue;
    try {
      ops.push(JSON.parse(raw) as OutboxOp);
    } catch {
      // a torn or foreign file; drainOnce removes it
    }
  }
  return ops;
}

async function send(op: OutboxOp): Promise<void> {
  switch (op.kind) {
    // false means fl0w-work refused this copy for good (it holds a newer one, or the workflow already exists)
    case 'session': await pushSession(op.session); return;
    case 'workflow': await pushWorkflow(op.workflow); return;
    case 'delete-session': await deleteRemoteSession(op.id); return;
    case 'delete-workflow': await deleteRemoteWorkflow(op.id); return;
  }
}

/** fl0w-work rejected the request itself, so sending it again won't help. */
const isPermanentFailure = (error: unknown): boolean =>
  error instanceof SyncHttpError
  && error.status >= 400 && error.status < 500
  && ![401, 408, 429].includes(error.status);

/** Pushes every pending write once; false when some failed in a way worth retrying. */
async function drainOnce(): Promise<boolean> {
  // signed out: writes stay on disk until the next signed-in run
  if (!(await readFl0wAuth())) return true;

  let allSent = true;
  for (const name of outboxFiles()) {
    const path = join(OUTBOX_DIR, name);
    const raw = readOrNull(path);
    if (raw === null) continue;

    let op: OutboxOp;
    try {
      op = JSON.parse(raw) as OutboxOp;
    } catch {
      rmSync(path, { force: true });
      continue;
    }

    try {
      await send(op);
    } catch (error) {
      if (!isPermanentFailure(error)) {
        allSent = false;
        continue;
      }
    }
    // a newer save written while this one was in flight stays queued
    if (readOrNull(path) === raw) rmSync(path, { force: true });
  }
  return allSent;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    drainOutboxInBackground();
  }, retryDelay);
  retryTimer.unref?.();
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

function drain(): Promise<void> {
  const run = queue.then(async () => {
    if (await drainOnce()) retryDelay = RETRY_MIN_MS;
    else scheduleRetry();
  });
  queue = run.catch(() => { });
  return queue as Promise<void>;
}

/** Pushes pending writes without waiting; failures retry with backoff while the process runs, and on the next run. */
export function drainOutboxInBackground(): void {
  void drain();
}

/** Pushes pending writes now and waits; anything that still fails stays in the outbox for the next run. */
export async function flushOutbox(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  await drain();
}
