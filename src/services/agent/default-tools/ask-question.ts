import { jsonSchema, tool } from "ai";

export type AskQuestionOption = { id: string; label: string };
export type AskQuestionItem = {
  id: string;
  prompt?: string;
  question?: string;
  options: AskQuestionOption[];
  allow_multiple?: boolean;
};
export type AskQuestionInput = {
  title?: string;
  questions: AskQuestionItem[];
};

const OTHER_OPTION: AskQuestionOption = { id: 'other', label: 'Other' };

const askQuestionInputSchema = jsonSchema<AskQuestionInput>({
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Clarifying questions to ask the user',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable identifier for the question' },
          question: { type: 'string', description: 'The question to ask the user' },
          options: {
            type: 'array',
            description: 'Selectable answers; include an "other" option for custom input',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['id', 'label'],
            },
          },
        },
        required: ['id', 'question', 'options'],
      },
    },
  },
  required: ['questions'],
});

export const askQuestionDescription =
  'Ask the user clarifying questions with selectable options or a custom answer.';

export const askQuestionTool = tool({
  description: askQuestionDescription,
  inputSchema: askQuestionInputSchema,
});

export const askQuestionToolSchema = askQuestionInputSchema.jsonSchema as Record<string, unknown>;
