import type { ReasoningLevel } from "./reasoning-agent";
import { isStepCount, streamText, type ModelMessage, type PrepareStepFunction, type StopCondition, type ToolSet } from "ai";
import type { Fl0wMessage } from "../../../models/agent";
import type { ToolOptions } from "../tool-search";
import { retryModelCall } from "../../service-utils";
import { frontLoadInstructions } from "../hooks/front-load";
import { MAX_ITERATIONS, PLAN_CHECK_MAX_RETRIES } from "../../../constants";
import { toModelMessages, type AgentResult } from "../utils/message-utils";
import { DEFAULT_CREATE_PLAN_TOOL } from "../default-tools/tool-utils";

const planCreated: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.toolResults.some((result) => result.toolName === DEFAULT_CREATE_PLAN_TOOL) ?? false;

/**
 * Every step must call a tool, so the phase can only end with a plan (or a pending ask_question, which has no
 * executor and stops the loop). The final steps are forced to create_plan, leaving room to retry an invalid plan.
 */
const forcePlan = (inner: PrepareStepFunction<ToolSet> | undefined): PrepareStepFunction<ToolSet> => async (options) => {
  const prepared = (await inner?.(options)) ?? {};
  if (options.stepNumber < MAX_ITERATIONS - PLAN_CHECK_MAX_RETRIES - 1) return { ...prepared, toolChoice: "required" };
  const activeTools = prepared.activeTools && [...new Set([...prepared.activeTools, DEFAULT_CREATE_PLAN_TOOL])];
  return { ...prepared, ...(activeTools && { activeTools }), toolChoice: { type: "tool", toolName: DEFAULT_CREATE_PLAN_TOOL } };
};

export const planAgent = async (messages: Fl0wMessage[], model: string, reasoning: ReasoningLevel, abort: AbortSignal, onStreamText: (text: string) => void, tools: ToolOptions | undefined, onStep: (stepMessages: ModelMessage[]) => void): Promise<AgentResult> => {
  const systemPrompt = `You are a planning agent. First scope the problem and the current state of the project, then use the default/create_plan tool to map a plan for an execution-focused agent to complete step-by-step.

Research as needed before planning: depending on the task and project, read files, search, and look things up so the plan is grounded in what actually exists. For coding projects, find the AGENTS.md and README.md if present. Skip research the task doesn't need.

IMPORTANT: You are only given read tools. The execution agent that carries out your plan will have more tools not in your search_tools outputs, like browser use and edit, so plan for steps you cannot perform yourself.

Use the default/ask_question tool to ask the user clarifying questions. Do not ask questions if the task is clear.

You must finish by calling default/create_plan — every task gets a plan, even a one-step one. Give each step a 1-based \`index\` and a concise \`description\`; the execution agent marks steps complete by index. Put findings the execution agent needs (file paths, current behavior, constraints) into the step descriptions.`;
  const instructions = `${await frontLoadInstructions()}\n\n${systemPrompt}`;
  return retryModelCall(async () => streamText({
    model,
    reasoning,
    instructions,
    messages: toModelMessages(messages),
    ...tools,
    prepareStep: forcePlan(tools?.prepareStep),
    stopWhen: [planCreated, isStepCount(MAX_ITERATIONS)],
    abortSignal: abort,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onStreamText(chunk.text);
    },
    onStepFinish: (step) => onStep(step.response.messages),
  }));
}
