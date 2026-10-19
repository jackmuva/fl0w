import { WorkflowStore } from '../../db/workflow-store';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../config/app-config';
import { deleteRemoteWorkflow, getRemoteWorkflow, listRemoteWorkflows, pushWorkflow } from '../remote-api/sync-api';

let queue: Promise<unknown> = Promise.resolve();

export type WorkflowSyncResult = { pushed: number, pulled: number };

export async function syncWorkflows(store?: WorkflowStore): Promise<WorkflowSyncResult | null> {
  const run = queue.then(async () => {
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const local = store ?? WorkflowStore.open();
    const toPull = new Set((await listRemoteWorkflows()).map((w) => w.id));
    const result: WorkflowSyncResult = { pushed: 0, pulled: 0 };

    for (const workflow of local.listWorkflows()) {
      if (toPull.delete(workflow.id)) continue;
      if (await pushWorkflow(workflow)) result.pushed++;
    }

    for (const id of toPull) {
      const workflow = await getRemoteWorkflow(id);
      if (!workflow) continue;
      local.importWorkflow(workflow);
      result.pulled++;
    }
    return result;
  });
  queue = run.catch(() => { });
  return run;
}

export function syncWorkflowsInBackground(store?: WorkflowStore): void {
  void syncWorkflows(store).catch(() => null);
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
  await queue;
}
