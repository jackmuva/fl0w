import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTBOX_DIR } from '../../constants';
import type { StoredSession } from '../../models/session';
import type { WorkflowRecord } from '../../models/workflow';
import { authService } from '../auth/auth-service';
import { deleteRemoteSession, deleteRemoteWorkflow, pushSession, pushWorkflow } from '../remote-api/sync-api';
import { SyncHttpError } from '../remote-api/api-utils';

export type OutboxOp =
  | { kind: 'session', session: StoredSession }
  | { kind: 'workflow', workflow: WorkflowRecord }
  | { kind: 'delete-session', id: string }
  | { kind: 'delete-workflow', id: string };

const PUSH_DEBOUNCE_MS = 2_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;

class OutboxStore {
  private queue: Promise<unknown> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN_MS;

  private readonly opId = (op: OutboxOp): string =>
    op.kind === 'session' ? op.session.id : op.kind === 'workflow' ? op.workflow.id : op.id;

  private readonly opPath = (kind: OutboxOp['kind'], id: string): string =>
    join(OUTBOX_DIR, `${kind}-${encodeURIComponent(id)}.json`);

  private readonly readOrNull = (path: string): string | null => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };

  private readonly outboxFiles = (): string[] => {
    try {
      return readdirSync(OUTBOX_DIR).filter((name) => name.endsWith('.json')).sort();
    } catch {
      return [];
    }
  };

    enqueue(op: OutboxOp): void {
    mkdirSync(OUTBOX_DIR, { recursive: true });
    const id = this.opId(op);
    if (op.kind === 'delete-session') rmSync(this.opPath('session', id), { force: true });
    if (op.kind === 'delete-workflow') rmSync(this.opPath('workflow', id), { force: true });
    if (op.kind === 'session' && existsSync(this.opPath('delete-session', id))) return;
    if (op.kind === 'workflow' && existsSync(this.opPath('delete-workflow', id))) return;

    const path = this.opPath(op.kind, id);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(op));
    renameSync(tmp, path);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.drainOutboxInBackground();
    }, PUSH_DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  /** Every write not yet pushed, oldest file name first. */
  pendingOps(): OutboxOp[] {
    const ops: OutboxOp[] = [];
    for (const name of this.outboxFiles()) {
      const raw = this.readOrNull(join(OUTBOX_DIR, name));
      if (raw === null) continue;
      try {
        ops.push(JSON.parse(raw) as OutboxOp);
      } catch {
        // a torn or foreign file; drainOnce removes it
      }
    }
    return ops;
  }

  private async send(op: OutboxOp): Promise<void> {
    switch (op.kind) {
      // false means fl0w-work refused this copy for good (it holds a newer one, or the workflow already exists)
      case 'session': await pushSession(op.session); return;
      case 'workflow': await pushWorkflow(op.workflow); return;
      case 'delete-session': await deleteRemoteSession(op.id); return;
      case 'delete-workflow': await deleteRemoteWorkflow(op.id); return;
    }
  }

  /** fl0w-work rejected the request itself, so sending it again won't help. */
  private readonly isPermanentFailure = (error: unknown): boolean =>
    error instanceof SyncHttpError
    && error.status >= 400 && error.status < 500
    && ![401, 408, 429].includes(error.status);

  /** Pushes every pending write once; false when some failed in a way worth retrying. */
  private async drainOnce(): Promise<boolean> {
    // signed out: writes stay on disk until the next signed-in run
    if (!(await authService.readFl0wAuth())) return true;

    let allSent = true;
    for (const name of this.outboxFiles()) {
      const path = join(OUTBOX_DIR, name);
      const raw = this.readOrNull(path);
      if (raw === null) continue;

      let op: OutboxOp;
      try {
        op = JSON.parse(raw) as OutboxOp;
      } catch {
        rmSync(path, { force: true });
        continue;
      }

      try {
        await this.send(op);
      } catch (error) {
        if (!this.isPermanentFailure(error)) {
          allSent = false;
          continue;
        }
      }
      // a newer save written while this one was in flight stays queued
      if (this.readOrNull(path) === raw) rmSync(path, { force: true });
    }
    return allSent;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drainOutboxInBackground();
    }, this.retryDelay);
    this.retryTimer.unref?.();
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private drain(): Promise<void> {
    const run = this.queue.then(async () => {
      if (await this.drainOnce()) this.retryDelay = RETRY_MIN_MS;
      else this.scheduleRetry();
    });
    this.queue = run.catch(() => { });
    return this.queue as Promise<void>;
  }

  /** Pushes pending writes without waiting; failures retry with backoff while the process runs, and on the next run. */
  drainOutboxInBackground(): void {
    void this.drain();
  }

  /** Pushes pending writes now and waits; anything that still fails stays in the outbox for the next run. */
  async flushOutbox(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.drain();
  }
}

export const outboxStore = new OutboxStore();
