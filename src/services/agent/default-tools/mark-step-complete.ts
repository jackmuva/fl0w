import { jsonSchema, tool } from 'ai';

export type MarkStepCompleteInput = {
  index: number;
  note?: string;
};

const markStepCompleteInputSchema = jsonSchema<MarkStepCompleteInput>({
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      minimum: 1,
      description: 'The index of the plan step that was completed',
    },
    note: {
      type: 'string',
      description: 'Optional one-line note about how the step was completed',
    },
  },
  required: ['index'],
}, {
  validate: (value) => Number.isInteger((value as Partial<MarkStepCompleteInput>)?.index) && (value as MarkStepCompleteInput).index >= 1
    ? { success: true, value: value as MarkStepCompleteInput }
    : { success: false, error: new Error('MarkStepComplete requires a positive integer `index`') },
});

export const executeMarkStepComplete = async (input: MarkStepCompleteInput) => {
  if (!Number.isInteger(input?.index) || input.index < 1) throw new Error('mark_step_complete requires a positive integer `index`');
  return `Step ${input.index} marked complete`;
};

export const markStepCompleteDescription =
  'Mark a step of the current workflow plan (created with default/create_plan) as complete, by its index. Call this as soon as each step is done.';

export const markStepCompleteTool = tool({
  description: markStepCompleteDescription,
  inputSchema: markStepCompleteInputSchema,
  execute: executeMarkStepComplete,
});

export const markStepCompleteToolSchema = markStepCompleteInputSchema.jsonSchema as Record<string, unknown>;
