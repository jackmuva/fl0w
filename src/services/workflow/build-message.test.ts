import { describe, expect, test } from 'bun:test';
import type { WorkflowRecord } from '../../models/workflow';
import { buildWorkflowUserMessage, parseWorkflowPrompt } from './build-message';

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
  createdAt: '1970-01-01T00:00:00.001Z',
  updatedAt: '1970-01-01T00:00:00.001Z',
  steps: [
    {
      intent: 'Find session store',
      action: 'Search for SessionStore usage',
      toolParameters: { pattern: 'SessionStore' },
    },
    {
      intent: 'Run lint',
      action: 'Verify types with the linter',
    },
  ],
};

describe('buildWorkflowUserMessage', () => {
  test('includes goal, steps, and additional instructions', () => {
    const message = buildWorkflowUserMessage(sampleWorkflow, 'Use the main branch');

    expect(message.role).toBe('user');
    expect(typeof message.content).toBe('string');
    const content = message.content as string;

    expect(content).toContain('[Workflow: Add persistence]');
    expect(content).toContain('Add SQLite-backed workflow storage');
    expect(content).toContain('Search for SessionStore usage');
    expect(content).toContain('"pattern":"SessionStore"');
    expect(content).toContain('Verify types with the linter');
    expect(content).toContain('Use the main branch');
  });

  test('omits additional instructions section when empty', () => {
    const message = buildWorkflowUserMessage(sampleWorkflow, '   ');
    const content = message.content as string;

    expect(content).not.toContain('## Additional instructions');
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
