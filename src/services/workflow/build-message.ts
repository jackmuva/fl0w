import type { ModelMessage } from 'ai';
import type { WorkflowRecord } from '../../models/workflow';

export const WORKFLOW_PROMPT_LEAD = 'Execute this workflow step by step.';

export const formatWorkflowHeader = (title: string): string => `[Workflow: ${title}]`;

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

const formatStep = (step: WorkflowRecord['steps'][number], index: number): string => {
  const lines = [
    `${index + 1}. **Intent:** ${step.intent}`,
    `   **Action:** ${step.action}`,
  ];

  if (step.toolParameters && Object.keys(step.toolParameters).length > 0) {
    lines.push(`   **Tool parameters:** ${JSON.stringify(step.toolParameters)}`);
  }

  return lines.join('\n');
};

export const buildWorkflowUserMessage = (
  workflow: WorkflowRecord,
  userInstructions: string,
): ModelMessage => {
  const stepsText = workflow.steps.map(formatStep).join('\n\n');
  const instructionsBlock = userInstructions.trim()
    ? `\n\n## Additional instructions\n\n${userInstructions.trim()}`
    : '';

  return {
    role: 'user',
    content: [
      formatWorkflowHeader(workflow.title),
      '',
      WORKFLOW_PROMPT_LEAD,
      'If additional instructions or values are given, use them for {{placeholder}} values below (additional instructions and values are optional).',
      '',
      '## Goal',
      '',
      workflow.goal,
      '',
      '## Steps',
      '',
      stepsText,
      instructionsBlock,
    ].join('\n'),
  };
};
