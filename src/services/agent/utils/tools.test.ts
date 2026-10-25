import { describe, expect, test } from 'bun:test';
import { listAllTools } from './tools';

const toolNames = async (unattended: boolean) => (await listAllTools(unattended)).map((entry) => entry.name);

describe('listAllTools', () => {
  test('offers ask_question when a session can wait on the answer', async () => {
    expect(await toolNames(false)).toContain('ask_question');
  });

  test('withholds ask_question from an unattended workflow run', async () => {
    expect(await toolNames(true)).not.toContain('ask_question');
  });
});
