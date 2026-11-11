import { describe, expect, test } from 'bun:test';
import { toolsFor, toolsForSubagent } from './toolpacks';

const keys = async (tools: ReturnType<typeof toolsForSubagent>) => Object.keys((await tools)?.tools ?? {});

describe('subagent toolpacks', () => {
  test('the execute phase can launch sub-agents', async () => {
    expect(await keys(toolsFor('EXECUTE'))).toContain('default__subagent');
  });

  test('the plan phase cannot, but can research and create the plan', async () => {
    const plan = await keys(toolsFor('PLAN'));
    expect(plan).toContain('default__read');
    expect(plan).toContain('default__create_plan');
    expect(plan).not.toContain('default__subagent');
  });

  test('sub-agents cannot nest, ask the user, or touch the plan', async () => {
    const tools = await keys(toolsForSubagent());
    expect(tools).toContain('default__bash');
    for (const name of ['subagent', 'ask_question', 'create_plan', 'mark_step_complete']) {
      expect(tools).not.toContain(`default__${name}`);
    }
  });
});
