import type { CapabilitySelection } from '../../models/agent';
import type { WorkflowRecord, WorkflowStep } from '../../models/workflow';
import { getRemoteWorkflow, listRemoteWorkflows } from '../remote-api/sync-api';
import { nowIso } from '../session/session-record';
import { enqueue, pendingOps } from '../sync/outbox';
import { normalizeWorkflowSteps } from './generate';

/** Creates and deletes not yet pushed, so reads see this device's latest writes. */
const pendingWorkflows = () => {
  const created = new Map<string, WorkflowRecord>();
  const deleted = new Set<string>();
  for (const op of pendingOps()) {
    if (op.kind === 'workflow') created.set(op.workflow.id, op.workflow);
    else if (op.kind === 'delete-workflow') deleted.add(op.id);
  }
  return { created, deleted };
};

/** Workflows on fl0w-work plus unpushed ones, newest first. */
export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const byId = new Map((await listRemoteWorkflows()).map((workflow) => [workflow.id, workflow]));
  const { created, deleted } = pendingWorkflows();
  for (const workflow of created.values()) {
    if (!byId.has(workflow.id)) byId.set(workflow.id, workflow);
  }
  return [...byId.values()]
    .filter(({ id }) => !deleted.has(id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkflow(id: string): Promise<WorkflowRecord | null> {
  const { created, deleted } = pendingWorkflows();
  if (deleted.has(id)) return null;
  return created.get(id) ?? getRemoteWorkflow(id);
}

/** Queues the new workflow for a background push and returns it right away. */
export function saveWorkflow(input: {
  sourceSessionId?: string | null;
  title: string;
  goal: string;
  steps: WorkflowStep[];
  requiredCapabilities: CapabilitySelection;
}): WorkflowRecord {
  const now = nowIso();
  const workflow: WorkflowRecord = {
    id: crypto.randomUUID(),
    sourceSessionId: input.sourceSessionId ?? null,
    title: input.title.trim(),
    goal: input.goal.trim(),
    steps: normalizeWorkflowSteps(input.steps),
    requiredCapabilities: input.requiredCapabilities,
    createdAt: now,
    updatedAt: now,
  };
  enqueue({ kind: 'workflow', workflow });
  return workflow;
}

export function deleteWorkflow(id: string): void {
  enqueue({ kind: 'delete-workflow', id });
}
