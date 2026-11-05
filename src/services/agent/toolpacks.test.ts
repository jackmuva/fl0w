import { describe, expect, test } from 'bun:test';
import { toolsFor, toolsForSubagent } from './toolpacks';

const keys = async (tools: ReturnType<typeof toolsForSubagent>) => Object.keys((await tools)?.tools ?? {});

describe('subagent toolpacks', () => {
  test('the execute phase can launch sub-agents', async () => {
    expect(await keys(toolsFor('EXECUTE'))).toContain('default__subagent');
  });

  test('discovery and plan phases cannot', async () => {
    expect(await keys(toolsFor('DISCOVERY'))).not.toContain('default__subagent');
    expect(await keys(toolsFor('PLAN'))).not.toContain('default__subagent');
  });

  test('sub-agents cannot nest, ask the user, or touch the plan', async () => {
    const tools = await keys(toolsForSubagent());
    expect(tools).toContain('default__bash');
    for (const name of ['subagent', 'ask_question', 'create_plan', 'mark_step_complete']) {
      expect(tools).not.toContain(`default__${name}`);
    }
  });
});
