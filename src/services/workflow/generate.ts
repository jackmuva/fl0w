import {
  APICallError,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  UnsupportedFunctionalityError,
} from 'ai';
import { recordLlmUsage } from '../agent/hooks/session-usage';
import type { Fl0wMessage } from '../../models/agent';
import { mcpToolKey, type McpTool } from '../../models/mcp';
import { extractToolCalls, hasConversationContent } from './extract-tool-calls';
import {
  DEFAULT_ASK_QUESTION_TOOL,
  DEFAULT_CREATE_PLAN_TOOL,
  DEFAULT_MARK_STEP_COMPLETE_TOOL,
} from '../agent/default-tools/utils';
import type { GeneratedWorkflow, WorkflowStep, WorkflowToolCall } from '../../models/workflow';

export type WorkflowToolCatalogEntry = Pick<McpTool, 'server' | 'name' | 'description'>;

// Workflow runs seed their own plan and are not interactive, so steps never call these.
const NON_STEP_TOOLS = new Set([DEFAULT_ASK_QUESTION_TOOL, DEFAULT_CREATE_PLAN_TOOL, DEFAULT_MARK_STEP_COMPLETE_TOOL]);

export type GeneratedPlan = {
  title: string;
  goal: string;
  steps: { index: number; description: string }[];
};

export type GeneratedStepInstructions = {
  steps: {
    index: number;
    instructions: string;
    tools?: { tool: string; parameters?: Record<string, unknown> }[];
  }[];
};

export class WorkflowGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowGenerationError';
  }
}

const stringifyParameters = (parameters: Record<string, unknown> | undefined): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (value === undefined || value === null) continue;
    normalized[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return normalized;
};

export const normalizeWorkflowStep = (step: WorkflowStep): WorkflowStep => {
  const normalized: WorkflowStep = {
    index: step.index,
    description: step.description.trim(),
    instructions: step.instructions.trim(),
  };
  const tools: WorkflowToolCall[] = (step.tools ?? [])
    .map((call) => ({ tool: call.tool.trim(), parameters: stringifyParameters(call.parameters) }))
    .filter((call) => call.tool);
  return tools.length > 0 ? { ...normalized, tools } : normalized;
};

export const normalizeWorkflowSteps = (steps: WorkflowStep[]): WorkflowStep[] =>
  steps.map(normalizeWorkflowStep);

const planSchema = jsonSchema<GeneratedPlan>({
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short workflow name (max 80 chars)' },
    goal: { type: 'string', description: 'One sentence describing the outcome' },
    steps: {
      type: 'array',
      minItems: 1,
      description: 'Ordered steps forming the successful workflow path',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 1, description: '1-based step number' },
          description: { type: 'string', description: 'What this step accomplishes' },
        },
        required: ['index', 'description'],
      },
    },
  },
  required: ['title', 'goal', 'steps'],
});

const instructionsSchema = jsonSchema<GeneratedStepInstructions>({
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      minItems: 1,
      description: 'One entry per plan step',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 1, description: 'The plan step this entry is for' },
          instructions: { type: 'string', description: 'Imperative instructions for completing the step' },
          tools: {
            type: 'array',
            description: 'Tools to call for this step, in order; omit when no specific tool applies',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: 'Tool key exactly as listed in the catalog (server/name)' },
                parameters: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                  description: "Tool arguments; use {{placeholder}} for values that come from the user's instructions later",
                },
              },
              required: ['tool'],
            },
          },
        },
        required: ['index', 'instructions'],
      },
    },
  },
  required: ['steps'],
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

const buildSessionContext = (conversation: Fl0wMessage[]): string => {
  const summary = conversation
    .map(messageToSummaryLine)
    .filter((line): line is string => line !== null)
    .join('\n');
  return `Conversation:\n${summary}\n\nTool-call trace:\n${stringifyToolCalls(extractToolCalls(conversation))}`;
};

const formatToolCatalog = (tools: WorkflowToolCatalogEntry[]): string =>
  tools.length === 0
    ? '(none)'
    : tools.map((entry) => {
      const description = entry.description?.split('\n')[0]?.trim();
      return description ? `- ${mcpToolKey(entry)}: ${description}` : `- ${mcpToolKey(entry)}`;
    }).join('\n');

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

export const parseJsonObject = (text: string): Record<string, unknown> => {
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
  return parsed as Record<string, unknown>;
};

export const validateGeneratedPlan = (value: unknown): GeneratedPlan => {
  const record = value as Partial<GeneratedPlan> | null;
  if (typeof record?.title !== 'string' || typeof record.goal !== 'string' || !Array.isArray(record.steps)) {
    throw new WorkflowGenerationError('Generated plan is missing required fields');
  }

  const steps = record.steps
    .filter((step) => Number.isInteger(step?.index) && typeof step.description === 'string' && step.description.trim())
    .sort((a, b) => a.index - b.index)
    // renumber so indices are 1..n whatever the model emitted
    .map((step, position) => ({ index: position + 1, description: step.description.trim() }));

  const title = record.title.trim();
  const goal = record.goal.trim();
  if (!title || !goal || steps.length === 0) {
    throw new WorkflowGenerationError('Generated plan is missing required fields');
  }
  return { title, goal, steps };
};

export const validateGeneratedInstructions = (value: unknown): GeneratedStepInstructions => {
  const steps = (value as Partial<GeneratedStepInstructions> | null)?.steps;
  if (!Array.isArray(steps)) {
    throw new WorkflowGenerationError('Generated step instructions are missing required fields');
  }
  return {
    steps: steps.filter((step) => Number.isInteger(step?.index) && typeof step.instructions === 'string'),
  };
};

export const mergePlanAndInstructions = (
  plan: GeneratedPlan,
  instructions: GeneratedStepInstructions,
  tools: WorkflowToolCatalogEntry[],
): GeneratedWorkflow => {
  const knownTools = new Set(tools.map(mcpToolKey));
  const byIndex = new Map(instructions.steps.map((step) => [step.index, step]));

  const steps = plan.steps.map((planStep): WorkflowStep => {
    const detail = byIndex.get(planStep.index);
    if (!detail?.instructions.trim()) {
      throw new WorkflowGenerationError(`Generated workflow has no instructions for step ${planStep.index}`);
    }
    const calls = (detail.tools ?? [])
      .filter((call) => typeof call?.tool === 'string' && knownTools.has(call.tool.trim()))
      .map((call) => ({ tool: call.tool, parameters: stringifyParameters(call.parameters) }));
    return normalizeWorkflowStep({
      index: planStep.index,
      description: planStep.description,
      instructions: detail.instructions,
      ...(calls.length > 0 && { tools: calls }),
    });
  });

  return { title: plan.title, goal: plan.goal, steps };
};

/** Structured output when the model supports it, else the same prompt asking for raw JSON. */
const generateStructured = async <T>(
  model: string,
  prompt: string,
  schema: ReturnType<typeof jsonSchema<T>>,
  name: string,
  jsonShape: string,
  validate: (value: unknown) => T,
): Promise<T> => {
  try {
    const generation = await generateText({
      model,
      prompt,
      output: Output.object({ schema, name }),
    });
    recordLlmUsage(generation);
    return validate(generation.output);
  } catch { }

  try {
    const generation = await generateText({
      model,
      prompt: `${prompt}\n\nReturn only a single JSON object (no markdown fences or surrounding prose) with:\n${jsonShape}`,
    });
    recordLlmUsage(generation);
    return validate(parseJsonObject(generation.text));
  } catch (error) {
    if (error instanceof WorkflowGenerationError) throw error;
    throw new WorkflowGenerationError('Could not parse generated workflow JSON');
  }
};

export const generateWorkflowPlan = (context: string, model: string): Promise<GeneratedPlan> =>
  generateStructured(
    model,
    `You are a planning agent that turns completed agent sessions into reusable workflows.

Given the conversation and tool-call trace below, distill the successful path into an ordered plan.
- Remove failed or exploratory work; keep only what led to the result.
- Each step should be one checkable unit of work an execution agent can mark complete.
- Describe steps generically so the workflow can be rerun with different inputs.

${context}`,
    planSchema,
    'WorkflowPlan',
    '- title: string (short workflow name, max 80 chars)\n- goal: string (one sentence outcome)\n- steps: array of { index: integer (1-based), description: string }',
    validateGeneratedPlan,
  );

export const generateStepInstructions = (
  context: string,
  plan: GeneratedPlan,
  tools: WorkflowToolCatalogEntry[],
  model: string,
): Promise<GeneratedStepInstructions> =>
  generateStructured(
    model,
    `You write execution instructions for a workflow plan, using the agent session it was distilled from.

For every plan step, give:
- index: the plan step's index
- instructions: imperative instructions an execution agent can follow without the original session
- tools: the tools to call, in order, with their parameters. Only name tools from the catalog below, using the exact key. Base tool choices and parameters on the tool-call trace; omit tools when no specific tool can be pinned down.
- In parameters, replace values that will differ between runs (names, paths, ids, queries) with {{placeholder}} names the user can fill in later.

Workflow: ${plan.title}
Goal: ${plan.goal}

Plan:
${plan.steps.map((step) => `${step.index}. ${step.description}`).join('\n')}

Tool catalog:
${formatToolCatalog(tools)}

${context}`,
    instructionsSchema,
    'WorkflowStepInstructions',
    '- steps: array of { index: integer, instructions: string, tools?: array of { tool: string, parameters?: object with string values } }',
    validateGeneratedInstructions,
  );

export const generateWorkflowFromSession = async (
  messages: Fl0wMessage[],
  model: string,
  tools: WorkflowToolCatalogEntry[],
): Promise<GeneratedWorkflow> => {
  const conversation = messages.filter(({ message }) => message.role !== 'system');
  if (!hasConversationContent(conversation)) {
    throw new WorkflowGenerationError('Selected session has no conversation to generate a workflow from');
  }

  // Tools the session called count even if they aren't enabled right now; the run enables the workflow's capabilities.
  const catalog = new Map(tools.map((entry) => [mcpToolKey(entry), entry]));
  for (const { toolName } of extractToolCalls(conversation)) {
    const slash = toolName.indexOf('/');
    if (slash > 0 && !catalog.has(toolName)) {
      catalog.set(toolName, { server: toolName.slice(0, slash), name: toolName.slice(slash + 1) });
    }
  }
  const stepTools = [...catalog.entries()]
    .filter(([key]) => !NON_STEP_TOOLS.has(key))
    .map(([, entry]) => entry);
  const context = buildSessionContext(conversation);
  const plan = await generateWorkflowPlan(context, model);
  const instructions = await generateStepInstructions(context, plan, stepTools, model);
  return mergePlanAndInstructions(plan, instructions, stepTools);
};
