import { jsonSchema, tool } from 'ai';

export type MessageAnswerInput = {
  answer: string;
};

export const messageAnswerDescription = `Use this tool to present an answer to the user's question. 

**IMPORTANT**: Be extremely concise unless the user asks for an elaboration or extremely detailed answer.

Example include: synthesizing results from tools calls, general answer to a question that doesn't require tools calls, an answer where the user requested a certain format.

Do NOT use this tool for commands or action requests (reading files, running commands, editing code, searching the codebase, etc.). For those, use the appropriate action tool instead.`;

const messageAnswerInputSchema = jsonSchema<MessageAnswerInput>({
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: 'The answer to present to the user',
    },
  },
  required: ['answer'],
});

export const executeMessageAnswer = ({ answer }: MessageAnswerInput): Promise<string> =>
  Promise.resolve(answer);

export const messageAnswerTool = tool({
  description: messageAnswerDescription,
  inputSchema: messageAnswerInputSchema,
  execute: executeMessageAnswer,
});

export const messageAnswerToolSchema = messageAnswerInputSchema.jsonSchema as Record<string, unknown>;
