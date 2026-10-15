import {
  APICallError,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  UnsupportedFunctionalityError,
} from 'ai';
import { recordLlmUsage } from '../agent/hooks/session-usage';
import { LLM_MODEL } from '../../constants';
import type { Fl0wMessage } from '../../models/agent';
import type { GeneratedWorkflow, WorkflowStep } from '../../models/workflow';
import { extractToolCalls, hasConversationContent } from './extract-tool-calls';

const workflowSchema = jsonSchema<GeneratedWorkflow>({
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short workflow name (max 80 chars)',
    },
    goal: {
      type: 'string',
      description: 'One sentence describing the outcome',
    },
    steps: {
      type: 'array',
      minItems: 1,
      description: 'Ordered steps forming the successful workflow path',
      items: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            description: 'Why the step exists',
          },
          action: {
            type: 'string',
            description: 'Imperative description of what to do (mention tools when relevant)',
          },
          toolParameters: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: "Optional tool arguments; use {{placeholder}} for values from the user's instructions later",
          },
        },
        required: ['intent', 'action'],
      },
    },
  },
  required: ['title', 'goal', 'steps'],
});

const stringifyToolCalls = (calls: ReturnType<typeof extractToolCalls>): string =>
  calls.length === 0
    ? '(none)'
    : calls.map((call, index) => `${index + 1}. ${call.toolName}(${JSON.stringify(call.input)})`).join('\n');

const messageToSummaryLine = ({ message }: Fl0wMessage): string | null => {
  if (message.role === 'user') {
    const text = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => ('text' in part ? part.text : '')).join('')
        : '';
    return `user: ${text.trim()}`;
  }

  if (message.role === 'assistant') {
    if (typeof message.content === 'string') {
      return message.content.trim() ? `assistant: ${message.content.trim()}` : null;
    }

    if (!Array.isArray(message.content)) return null;

    const parts = message.content.map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') return part.text;
      if (part.type === 'tool-call') return `[tool ${part.toolName}(${JSON.stringify(part.input)})]`;
      return '';
    }).filter(Boolean);

    return parts.length > 0 ? `assistant: ${parts.join(' ')}` : null;
  }

  return null;
};

const JSON_PROMPT_SUFFIX = `

Return only a single JSON object (no markdown fences or surrounding prose) with:
- title: string (short workflow name, max 80 chars)
- goal: string (one sentence outcome)
- steps: array of { intent: string, action: string, toolParameters?: object with string values }`;

export const isStructuredOutputUnsupported = (error: unknown): boolean => {
  if (UnsupportedFunctionalityError.isInstance(error)) return true;
  if (NoObjectGeneratedError.isInstance(error)) return true;
  if (APICallError.isInstance(error)) {
    const message = error.message.toLowerCase();
    return (
      message.includes('output format')
      || message.includes('structured output')
      || message.includes('response_format')
      || message.includes('json schema')
    );
  }
  return false;
};

export const parseGeneratedWorkflowJson = (text: string): GeneratedWorkflow => {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new WorkflowGenerationError('Could not parse generated workflow JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorkflowGenerationError('Could not parse generated workflow JSON');
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== 'string' || typeof record.goal !== 'string' || !Array.isArray(record.steps)) {
    throw new WorkflowGenerationError('Could not parse generated workflow JSON');
  }

  return parsed as GeneratedWorkflow;
};

const finalizeGeneratedWorkflow = (workflow: GeneratedWorkflow): GeneratedWorkflow => {
  const normalized = normalizeGeneratedWorkflow(workflow);
  if (!normalized.title || !normalized.goal || normalized.steps.length === 0) {
    throw new WorkflowGenerationError('Generated workflow is missing required fields');
  }
  return normalized;
};

const normalizeGeneratedWorkflow = (workflow: GeneratedWorkflow): GeneratedWorkflow => {
  const steps: WorkflowStep[] = workflow.steps.map((step) => ({
    intent: step.intent.trim(),
    action: step.action.trim(),
    ...(step.toolParameters && Object.keys(step.toolParameters).length > 0
      ? { toolParameters: step.toolParameters }
      : {}),
  }));

  return {
    title: workflow.title.trim(),
    goal: workflow.goal.trim(),
    steps,
  };
};

export class WorkflowGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowGenerationError';
  }
}

export const generateWorkflowFromSession = async (
  messages: Fl0wMessage[],
): Promise<GeneratedWorkflow> => {
  const conversation = messages.filter(({ message }) => message.role !== 'system');
  if (!hasConversationContent(conversation)) {
    throw new WorkflowGenerationError('Selected session has no conversation to generate a workflow from');
  }

  const toolCalls = extractToolCalls(conversation);
  const conversationSummary = conversation
    .map(messageToSummaryLine)
    .filter((line): line is string => line !== null)
    .join('\n');

  const instructions = `You analyze completed agent sessions and produce reusable workflows.

Given the conversation and tool-call trace below, distill the successful path into a workflow.

For each step:
- intent: why the step exists
- action: imperative description of what to do (mention tools when relevant)
- toolParameters: optional string map of tool arguments; use {{placeholder}} for values that should come from the user's instructions later

Remove failed or exploratory steps. Keep the successful path.

Conversation:
${conversationSummary}

Tool-call trace:
${stringifyToolCalls(toolCalls)}`;

  try {
    const generation = await generateText({
      model: LLM_MODEL,
      prompt: instructions,
      output: Output.object({
        schema: workflowSchema,
        name: 'GeneratedWorkflow',
        description: 'Reusable workflow distilled from a completed agent session',
      }),
    });
    recordLlmUsage(generation);
    return finalizeGeneratedWorkflow(generation.output);
  } catch (error) { }

  try {
    const generation = await generateText({
      model: LLM_MODEL,
      prompt: instructions + JSON_PROMPT_SUFFIX,
    });
    recordLlmUsage(generation);
    return finalizeGeneratedWorkflow(parseGeneratedWorkflowJson(generation.text));
  } catch (error) {
    if (error instanceof WorkflowGenerationError) throw error;
    throw new WorkflowGenerationError('Could not parse generated workflow JSON');
  }
};
