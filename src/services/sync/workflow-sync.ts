import { WorkflowStore } from '../../db/workflow-store';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../config/app-config';
import { listRemoteWorkflows, pushWorkflow } from './sync-api';

let queue: Promise<unknown> = Promise.resolve();

/**
 * Uploads local workflows fl0w-work doesn't have yet (workflows are immutable once saved, so ids are enough).
 * Returns the number pushed, or null when not signed in or `sync: false` is set in config.json.
 */
export async function syncWorkflows(store?: WorkflowStore): Promise<number | null> {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const remoteIds = new Set((await listRemoteWorkflows()).map((w) => w.id));
    let pushed = 0;
    for (const workflow of (store ?? WorkflowStore.open()).listWorkflows()) {
      if (!remoteIds.has(workflow.id) && await pushWorkflow(workflow)) pushed++;
    }
    return pushed;
  });
  queue = run.catch(() => { });
  return run;
}

/** Background push that never throws; failures retry on the next sync since unsynced ids are re-diffed. */
export function pushWorkflowsInBackground(store?: WorkflowStore): void {
  void syncWorkflows(store).catch(() => null);
}

/** Waits for in-flight workflow pushes; call before a deliberate exit. */
export async function flushWorkflowPushes(): Promise<void> {
  await queue;
}
