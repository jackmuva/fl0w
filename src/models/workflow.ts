import type { CapabilitySelection } from './agent';

/** A tool the step should call; `tool` is the `server/name` key, parameters may hold {{placeholder}} values. */
export type WorkflowToolCall = {
  tool: string;
  parameters: Record<string, string>;
};

export type WorkflowStep = {
  /** 1-based, matches the seeded create_plan step the execute agent marks complete. */
  index: number;
  description: string;
  instructions: string;
  tools?: WorkflowToolCall[];
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWorkflowToolCall = (value: unknown): value is WorkflowToolCall =>
  isRecord(value) && typeof value.tool === 'string' && isRecord(value.parameters);

export const isWorkflowStep = (value: unknown): value is WorkflowStep =>
  isRecord(value)
  && Number.isInteger(value.index)
  && typeof value.description === 'string'
  && typeof value.instructions === 'string'
  && (value.tools === undefined || (Array.isArray(value.tools) && value.tools.every(isWorkflowToolCall)));

/** Workflows saved before plan + instructions steps fail this and are skipped. */
export const isWorkflowRecord = (value: unknown): value is WorkflowRecord =>
  isRecord(value)
  && typeof value.id === 'string'
  && Array.isArray(value.steps)
  && value.steps.length > 0
  && value.steps.every(isWorkflowStep);
