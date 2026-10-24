import { describe, expect, test } from 'bun:test';
import { emptyCapabilitySelection } from '../services/agent/config';
import { WorkflowStore } from './workflow-store';

const sampleCapabilities = () => {
  const capabilities = emptyCapabilitySelection();
  capabilities.mcpServers = ['github'];
  return capabilities;
};

describe('WorkflowStore', () => {
  test('saves and lists workflows', () => {
    const store = WorkflowStore.openInMemory();

    const saved = store.saveWorkflow({
      sourceSessionId: 'session-1',
      title: 'Add persistence',
      goal: 'Add SQLite-backed workflow storage',
      requiredCapabilities: sampleCapabilities(),
      steps: [
        {
          intent: 'Find session store',
          action: 'Search for SessionStore usage',
          toolParameters: { pattern: 'SessionStore' },
        },
      ],
    });

    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const workflows = store.listWorkflows();
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.title).toBe('Add persistence');
    expect(workflows[0]?.steps[0]?.toolParameters).toEqual({ pattern: 'SessionStore' });
    expect(workflows[0]?.requiredCapabilities.mcpServers).toEqual(['github']);
  });

  test('gets a workflow by id', () => {
    const store = WorkflowStore.openInMemory();
    const saved = store.saveWorkflow({
      title: 'Test workflow',
      goal: 'Verify retrieval',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'Run tests', action: 'Execute bun test' }],
    });

    const loaded = store.getWorkflow(saved.id);
    expect(loaded?.goal).toBe('Verify retrieval');
    expect(store.getWorkflow('missing')).toBeNull();
  });

  test('orders workflows by most recently updated', async () => {
    const store = WorkflowStore.openInMemory();

    const first = store.saveWorkflow({
      title: 'First',
      goal: 'First goal',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'One', action: 'Do one thing' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = store.saveWorkflow({
      title: 'Second',
      goal: 'Second goal',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'Two', action: 'Do two things' }],
    });

    const workflows = store.listWorkflows();
    expect(workflows[0]?.id).toBe(second.id);
    expect(workflows[1]?.id).toBe(first.id);
  });

  test('deletes a workflow by id', () => {
    const store = WorkflowStore.openInMemory();
    const saved = store.saveWorkflow({
      title: 'Disposable',
      goal: 'Remove me',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'Delete', action: 'Remove workflow' }],
    });

    expect(store.deleteWorkflow(saved.id)).toBe(true);
    expect(store.listWorkflows()).toHaveLength(0);
    expect(store.deleteWorkflow(saved.id)).toBe(false);
  });

  test('lists workflows across all saves regardless of source session', () => {
    const store = WorkflowStore.openInMemory();

    store.saveWorkflow({
      sourceSessionId: 'session-a',
      title: 'From A',
      goal: 'Goal A',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'A', action: 'Do A' }],
    });

    store.saveWorkflow({
      sourceSessionId: 'session-b',
      title: 'From B',
      goal: 'Goal B',
      requiredCapabilities: emptyCapabilitySelection(),
      steps: [{ intent: 'B', action: 'Do B' }],
    });

    expect(store.listWorkflows()).toHaveLength(2);
  });
});
