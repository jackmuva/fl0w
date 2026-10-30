import { describe, expect, test } from 'bun:test';
import type { WorkflowRecord } from '../../models/workflow';
import { buildWorkflowPlanMessages, buildWorkflowUserMessage, parseWorkflowPrompt } from './build-message';

const sampleWorkflow: WorkflowRecord = {
  id: 'wf-1',
  sourceSessionId: null,
  title: 'Add persistence',
  goal: 'Add SQLite-backed workflow storage',
  requiredCapabilities: {
    skills: [],
    mcpServers: [],
    userTools: [],
    agentsMd: [],
  },
  models: null,
  createdAt: '1970-01-01T00:00:00.001Z',
  updatedAt: '1970-01-01T00:00:00.001Z',
  steps: [
    {
      index: 1,
      description: 'Find session store',
      instructions: 'Search for SessionStore usage',
      tools: [{ tool: 'default__grep', parameters: { pattern: 'SessionStore' } }],
    },
    {
      index: 2,
      description: 'Run lint',
      instructions: 'Verify types with the linter',
    },
  ],
};

describe('buildWorkflowUserMessage', () => {
  test('includes goal and additional instructions but leaves steps to the front-load', () => {
    const message = buildWorkflowUserMessage(sampleWorkflow, 'Use the main branch');

    expect(message.role).toBe('user');
    expect(typeof message.content).toBe('string');
    const content = message.content as string;

    expect(content).toContain('[Workflow: Add persistence]');
    expect(content).toContain('Add SQLite-backed workflow storage');
    expect(content).toContain('Use the main branch');
    expect(content).not.toContain('Search for SessionStore usage');
  });

  test('omits additional instructions section when empty', () => {
    const message = buildWorkflowUserMessage(sampleWorkflow, '   ');
    const content = message.content as string;

    expect(content).not.toContain('## Additional instructions');
  });
});

describe('buildWorkflowPlanMessages', () => {
  test('seeds a create_plan call and result with the workflow steps', () => {
    const [call, result] = buildWorkflowPlanMessages(sampleWorkflow);

    expect(call?.role).toBe('assistant');
    const callPart = (call?.content as Array<{ type: string; toolName: string; toolCallId: string; input: unknown }>)[0]!;
    expect(callPart.toolName).toBe('default__create_plan');
    expect(callPart.input).toEqual({
      title: 'Add persistence',
      steps: [
        { index: 1, description: 'Find session store' },
        { index: 2, description: 'Run lint' },
      ],
    });

    expect(result?.role).toBe('tool');
    const resultPart = (result?.content as Array<{ toolCallId: string }>)[0]!;
    expect(resultPart.toolCallId).toBe(callPart.toolCallId);
  });
});

describe('parseWorkflowPrompt', () => {
  test('parses titled workflow prompts', () => {
    const message = buildWorkflowUserMessage(sampleWorkflow, 'Use the main branch');
    const parsed = parseWorkflowPrompt(message.content as string);

    expect(parsed).toEqual({
      title: 'Add persistence',
      content: (message.content as string).replace('[Workflow: Add persistence]\n\n', ''),
    });
  });

  test('recognizes legacy workflow prompts without a header', () => {
    const content = 'Execute this workflow step by step.\n\n## Goal\n\nShip it';
    expect(parseWorkflowPrompt(content)).toEqual({
      title: 'Workflow',
      content,
    });
  });
});
