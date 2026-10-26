import type { ModelMessage } from 'ai';
import type { WorkflowRecord } from '../../models/workflow';
import { wrapPlanToolMessages } from '../agent/default-tools/create-plan';

export const WORKFLOW_PROMPT_LEAD = 'Execute this workflow step by step.';

export const parseWorkflowPrompt = (
  text: string,
): { title: string; content: string } | null => {
  const headerMatch = text.match(/^\[Workflow: ([^\]]+)\]\n\n([\s\S]*)$/);
  if (headerMatch) {
    return { title: headerMatch[1]!, content: headerMatch[2]! };
  }

  if (text.startsWith(WORKFLOW_PROMPT_LEAD)) {
    return { title: 'Workflow', content: text };
  }

  return null;
};

/** The step instructions themselves are front-loaded (see activeWorkflowStore); this message records the run in the transcript. */
export const buildWorkflowUserMessage = (
  workflow: WorkflowRecord,
  userInstructions: string,
): ModelMessage => {
  const instructionsBlock = userInstructions.trim()
    ? `\n\n## Additional instructions\n\n${userInstructions.trim()}`
    : '';

  return {
    role: 'user',
    content: [
      `[Workflow: ${workflow.title}]`,
      '',
      WORKFLOW_PROMPT_LEAD,
      '',
      '## Goal',
      '',
      workflow.goal,
      instructionsBlock,
    ].join('\n'),
  };
};

/** A create_plan call seeded from the workflow's steps, so the execute agent can mark them off by index. */
export const buildWorkflowPlanMessages = (workflow: WorkflowRecord): ModelMessage[] =>
  wrapPlanToolMessages(workflow.steps.map(({ index, description }) => ({ index, description })), workflow.title);
