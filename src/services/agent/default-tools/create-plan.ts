import { jsonSchema, tool, type ModelMessage } from 'ai';
import { DEFAULT_CREATE_PLAN_TOOL } from './tool-utils';

export type PlanStep = {
  index: number;
  description: string;
};

export type CreatePlanInput = {
  title?: string;
  steps: PlanStep[];
};

export const formatPlanSteps = (steps: PlanStep[]) =>
  steps.map((step) => `${step.index}. ${step.description.trim()}`).join('\n');

const validatePlanInput = (value: unknown): string | undefined => {
  const steps = (value as Partial<CreatePlanInput>)?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return 'CreatePlan requires a non-empty `steps` array';
  const seen = new Set<number>();
  for (const step of steps as Partial<PlanStep>[]) {
    if (!Number.isInteger(step?.index) || (step.index as number) < 1) return 'Each step needs a positive integer `index`';
    if (seen.has(step.index as number)) return `Duplicate step index: ${step.index}`;
    seen.add(step.index as number);
    if (typeof step.description !== 'string' || !step.description.trim()) return `Step ${step.index} needs a non-empty \`description\``;
  }
  return undefined;
};

export const executeCreatePlan = async (input: CreatePlanInput) => {
  const error = validatePlanInput(input);
  if (error) throw new Error(error);
  const body = formatPlanSteps(input.steps);
  return input.title?.trim() ? `${input.title.trim()}\n${body}` : body;
};

export const wrapPlanToolMessages = (
  steps: PlanStep[],
  title?: string,
  toolCallId: string = crypto.randomUUID(),
): [ModelMessage, ModelMessage] => {
  const input: CreatePlanInput = title?.trim() ? { title: title.trim(), steps } : { steps };

  return [
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId,
        toolName: DEFAULT_CREATE_PLAN_TOOL,
        input,
      }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName: DEFAULT_CREATE_PLAN_TOOL,
        output: { type: 'text', value: input.title ? `${input.title}\n${formatPlanSteps(steps)}` : formatPlanSteps(steps) },
      }],
    },
  ];
};

const createPlanInputSchema = jsonSchema<CreatePlanInput>({
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Optional short title for the plan',
    },
    steps: {
      type: 'array',
      minItems: 1,
      description: 'Ordered steps to complete the task',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 1, description: '1-based step number, used to mark the step complete' },
          description: { type: 'string', description: 'What this step accomplishes' },
        },
        required: ['index', 'description'],
      },
    },
  },
  required: ['steps'],
}, {
  validate: (value) => {
    const error = validatePlanInput(value);
    return error
      ? { success: false, error: new Error(error) }
      : { success: true, value: value as CreatePlanInput };
  },
});

export const createPlanDescription =
  'Present a step-by-step plan for completing a multi-step task. Each step has a 1-based index that the executing agent later passes to default/mark_step_complete.';

export const createPlanTool = tool({
  description: createPlanDescription,
  inputSchema: createPlanInputSchema,
  execute: executeCreatePlan,
});

export const createPlanToolSchema = createPlanInputSchema.jsonSchema as Record<string, unknown>;
