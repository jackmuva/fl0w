import { WorkflowStore } from '../../db/workflow-store';
import type { WorkflowRecord } from '../../models/workflow';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../config/app-config';
import { deleteRemoteWorkflow, getRemoteWorkflow, listRemoteWorkflows, pushWorkflow } from '../remote-api/sync-api';

const STARTUP_TIMEOUT_MS = 8_000;
const PUSH_DEBOUNCE_MS = 2_000;

let queue: Promise<unknown> = Promise.resolve();
let pendingPush: { timer: ReturnType<typeof setTimeout>, store?: WorkflowStore } | null = null;

export type WorkflowSyncResult = { pushed: number, pulled: number, errors?: string[] };

async function workflowExistsOnRemote(workflow: WorkflowRecord): Promise<boolean> {
  return (await getRemoteWorkflow(workflow.id)) !== null;
}


async function shouldPushLocalWorkflow(workflow: WorkflowRecord, remoteUpdatedAt: string | undefined): Promise<boolean> {
  if (remoteUpdatedAt === undefined) return true;
  if (remoteUpdatedAt > workflow.updatedAt) return false;
  if (remoteUpdatedAt < workflow.updatedAt) return true;
  return !(await workflowExistsOnRemote(workflow));
}

/**
 * Two-way sync keyed on `updatedAt` for push decisions. Workflows are immutable locally, but we still verify
 * remote bodies exist so list-only metadata cannot block a push forever.
 * Returns null when not signed in or `sync: false` is set in config.json.
 */
export async function syncWorkflows(store?: WorkflowStore): Promise<WorkflowSyncResult | null> {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const local = store ?? WorkflowStore.open();
    const toPull = new Map((await listRemoteWorkflows()).map((w) => [w.id, w.updatedAt]));
    const result: WorkflowSyncResult = { pushed: 0, pulled: 0 };
    const errors: string[] = [];

    for (const workflow of local.listWorkflows()) {
      try {
        const remoteUpdatedAt = toPull.get(workflow.id);
        if (remoteUpdatedAt !== undefined && remoteUpdatedAt > workflow.updatedAt) continue;
        toPull.delete(workflow.id);
        if (!(await shouldPushLocalWorkflow(workflow, remoteUpdatedAt))) continue;
        if (await pushWorkflow(workflow)) result.pushed++;
        else if (!(await workflowExistsOnRemote(workflow))) {
          errors.push(`Workflow "${workflow.title}" could not be pushed to fl0w-work`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    for (const id of toPull.keys()) {
      try {
        const workflow = await getRemoteWorkflow(id);
        if (!workflow) continue;
        local.importWorkflow(workflow);
        result.pulled++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (errors.length) result.errors = errors;
    return result;
  });
  queue = run.catch(() => { });
  return run;
}

export function syncWorkflowsInBackground(store?: WorkflowStore): void {
  void syncWorkflows(store).catch(() => null);
}

export function scheduleWorkflowPush(store?: WorkflowStore): void {
  if (pendingPush) clearTimeout(pendingPush.timer);
  pendingPush = {
    store,
    timer: setTimeout(() => {
      pendingPush = null;
      syncWorkflowsInBackground(store);
    }, PUSH_DEBOUNCE_MS),
  };
}

/** Queued behind in-flight syncs so a later sync can't pull the workflow back before it's gone remotely. */
export function deleteRemoteWorkflowInBackground(id: string): void {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return;
    await deleteRemoteWorkflow(id);
  });
  queue = run.catch(() => { });
}

export async function flushWorkflowPushes(): Promise<void> {
  if (pendingPush) {
    clearTimeout(pendingPush.timer);
    syncWorkflowsInBackground(pendingPush.store);
    pendingPush = null;
  }
  await queue;
}

export async function syncWorkflowsOnStartup(): Promise<string | null> {
  if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;
  try {
    const result = await Promise.race([
      syncWorkflows(),
      new Promise<'timeout'>((resolve) => setTimeout(resolve, STARTUP_TIMEOUT_MS, 'timeout').unref()),
    ]);
    if (result === 'timeout') return 'Workflow sync with fl0w-work timed out; will retry in the background.';
    if (result?.errors?.length) return `Workflow sync: ${result.errors.join('; ')}`;
    return null;
  } catch (error) {
    return `Workflow sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
