import type { WorkflowRecord } from "../models/workflow";

export type ActiveWorkflow = {
  workflow: WorkflowRecord;
  userInstructions: string;
};

class ActiveWorkflowStore {
  private activeWorkflow: ActiveWorkflow | null = null;

  get(): ActiveWorkflow | null {
    return this.activeWorkflow;
  }

  set(workflow: WorkflowRecord, userInstructions = ''): void {
    this.activeWorkflow = { workflow, userInstructions };
  }

  clear(): void {
    this.activeWorkflow = null;
  }
}

export const activeWorkflowStore = new ActiveWorkflowStore();
