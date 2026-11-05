import Bottleneck from 'bottleneck';
import { isStepCount, jsonSchema, streamText, tool } from 'ai';
import { MAX_ITERATIONS, MAX_PARALLEL_SUBAGENTS } from '../../../constants';
import { runContextStore } from '../../../store/run-context-store';
import { modelStore } from '../../../store/model-store';
import { sessionUsageStore } from '../../../store/session-usage-store';
import { retryModelCall } from '../../service-utils';
import { frontLoadInstructions } from '../hooks/front-load';

export type SubagentInput = {
  description: string;
  prompt: string;
};

const subagentInputSchema = jsonSchema<SubagentInput>({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A short (3-6 word) label for the task, shown to the user.',
    },
    prompt: {
      type: 'string',
      description: 'The complete task for the sub-agent. It cannot see this conversation, so include every file path, constraint and expected output it needs.',
    },
  },
  required: ['description', 'prompt'],
});

export const subagentDescription = `Launches a sub-agent: a separate execution agent with its own context and the same tools as you (except this one). It works on the task you give it and returns a final report as the tool result.

Use it to hand off self-contained chunks of work, especially independent tasks that can run in parallel.

Parallel execution:
- To run sub-agents in parallel, call this tool several times in the SAME response. Those calls run concurrently (up to ${MAX_PARALLEL_SUBAGENTS} at a time; extra calls queue).
- Only parallelise tasks that are independent. Never give two parallel sub-agents edits to the same file.
- If one task depends on another's result, call them in separate responses instead.

Writing the prompt:
- The sub-agent cannot see this conversation. Give it a self-contained brief: the goal, the relevant file paths, constraints, and what its report should contain.
- Its report is not shown to the user; relay what matters yourself.`;

const SUBAGENT_SYSTEM_PROMPT = `You are a sub-agent started by another execution agent to complete one task. Complete the task using your tools. Other sub-agents may be working in the same workspace at the same time, so only change the files your task is about. When you are done, reply with a concise final report of what you did and found, including any file paths you changed. That report is the only thing the agent that started you will see.`;

// Caps how many sub-agents run at once when the model fans out several calls in one step.
const subagentLimiter = new Bottleneck({ maxConcurrent: MAX_PARALLEL_SUBAGENTS });

const runSubagent = async ({ prompt }: SubagentInput, abortSignal?: AbortSignal): Promise<string> => {
  abortSignal?.throwIfAborted();
  const context = runContextStore.get();
  if (!context) throw new Error('subagent can only be used during an agent run.');
  // Loaded lazily: toolpacks imports the default tool registry, which imports this file.
  const { toolsForSubagent } = await import('../toolpacks');
  const instructions = `${await frontLoadInstructions()}\n\n${SUBAGENT_SYSTEM_PROMPT}`;
  const result = await retryModelCall(async () => streamText({
    model: context.model,
    reasoning: context.reasoning,
    instructions,
    messages: [{ role: 'user', content: prompt }],
    ...(await toolsForSubagent()),
    stopWhen: isStepCount(MAX_ITERATIONS),
    abortSignal,
  }));
  const window = await modelStore.contextWindowFor(context.model);
  let streamError: unknown;
  for await (const part of result.stream) {
    if (part.type === 'error') streamError ??= part.error;
    if (part.type === 'finish-step') sessionUsageStore.record(part, window);
  }
  abortSignal?.throwIfAborted();
  if (streamError !== undefined) {
    const reason = streamError instanceof Error ? streamError.message : String(streamError);
    throw new Error(`Sub-agent failed (${context.model}): ${reason}`, { cause: streamError });
  }
  const report = (await result.text).trim();
  return report || 'Sub-agent finished without a report.';
};

export const executeSubagent = (input: SubagentInput, options: { abortSignal?: AbortSignal } = {}): Promise<string> =>
  subagentLimiter.schedule(() => runSubagent(input, options.abortSignal));

export const subagentTool = tool({
  description: subagentDescription,
  inputSchema: subagentInputSchema,
  execute: (input, { abortSignal }) => executeSubagent(input, { abortSignal }),
});

export const subagentToolSchema = subagentInputSchema.jsonSchema as Record<string, unknown>;
