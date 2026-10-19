import { desc, eq } from 'drizzle-orm';
import { DB_PATH } from '../constants';
import type { CapabilitySelection } from '../models/agent';
import { type WorkflowRecord, type WorkflowStep } from '../models/workflow';
import { nowIso, openDatabase, workflows, type FlowDatabase } from './schema';
import { normalizeWorkflowSteps } from '../services/workflow/generate';

export class WorkflowStore {
  private readonly db: FlowDatabase;

  private constructor(db: FlowDatabase) {
    this.db = db;
  }

  static open(path = DB_PATH): WorkflowStore {
    return new WorkflowStore(openDatabase(path));
  }

  static openInMemory(): WorkflowStore {
    return new WorkflowStore(openDatabase(':memory:'));
  }

  listWorkflows(): WorkflowRecord[] {
    return this.db.select().from(workflows).orderBy(desc(workflows.updatedAt)).all();
  }

  getWorkflow(id: string): WorkflowRecord | null {
    return this.db.select().from(workflows).where(eq(workflows.id, id)).get() ?? null;
  }

  saveWorkflow(input: {
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

    this.db.insert(workflows).values(workflow).run();
    return workflow;
  }

  deleteWorkflow(workflowId: string): boolean {
    const result = this.db.delete(workflows).where(eq(workflows.id, workflowId)).run();
    return result.changes > 0;
  }

  /** Inserts a workflow pulled from fl0w-work; workflows are immutable, so an existing id is left as is. */
  importWorkflow(workflow: WorkflowRecord): void {
    this.db.insert(workflows).values(workflow).onConflictDoNothing({ target: workflows.id }).run();
  }
}
