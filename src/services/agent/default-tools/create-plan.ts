import { jsonSchema, tool, type ModelMessage } from 'ai';
import { DEFAULT_CREATE_PLAN_TOOL } from './utils';

export type CreatePlanInput = {
  plan: string;
};

export const wrapPlanToolMessages = (
  plan: string,
  toolCallId: string = crypto.randomUUID(),
): [ModelMessage, ModelMessage] => {
  const input: CreatePlanInput = { plan };

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
        output: { type: 'text', value: plan },
      }],
    },
  ];
};

const createPlanInputSchema = jsonSchema<CreatePlanInput>({
  type: 'object',
  properties: {
    plan: {
      type: 'string',
      description: 'A short numbered list of steps to complete the task',
    },
  },
  required: ['plan'],
}, {
  validate: (value) => typeof (value as Partial<CreatePlanInput>)?.plan === 'string' && (value as CreatePlanInput).plan.trim()
    ? { success: true, value: value as CreatePlanInput }
    : { success: false, error: new Error('CreatePlan requires a non-empty `plan` string') },
});

export const createPlanDescription =
  'Present a step-by-step plan for completing a multi-step task.';

export const createPlanTool = tool({
  description: createPlanDescription,
  inputSchema: createPlanInputSchema,
});

export const createPlanToolSchema = createPlanInputSchema.jsonSchema as Record<string, unknown>;
