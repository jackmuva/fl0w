import type { CapabilitySelection } from './agent';

export type WorkflowStep = {
  intent: string;
  action: string;
  toolParameters?: Record<string, string>;
};

export type WorkflowRecord = {
  id: string;
  sourceSessionId: string | null;
  title: string;
  goal: string;
  steps: WorkflowStep[];
  requiredCapabilities: CapabilitySelection;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedWorkflow = Pick<WorkflowRecord, 'title' | 'goal' | 'steps'>;
