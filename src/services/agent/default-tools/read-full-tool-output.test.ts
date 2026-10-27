import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { sessionWorkspacePath, TOOL_OUTPUT_MAX_CHARS } from '../../../constants';
import type { McpToolResult } from '../../../models/mcp';
import { executeReadFullToolOutput, TOOL_OUTPUT_FILE_PATTERN } from './read-full-tool-output';
import { capToolOutput } from '../utils/tool-utils';

const sessionId = `test-${crypto.randomUUID()}`;

const result = (content: string): McpToolResult => ({ server: 'default', tool: 'bash', isError: false, content });

afterEach(async () => {
  await rm(sessionWorkspacePath(sessionId), { recursive: true, force: true });
});

describe('capToolOutput', () => {
  test('leaves short outputs unchanged', async () => {
    const short = result('ok');
    expect(await capToolOutput(short, 'call-1', sessionId)).toBe(short);
  });

  test('truncates long outputs and saves the full text to the session workspace', async () => {
    const full = 'a'.repeat(TOOL_OUTPUT_MAX_CHARS) + 'z'.repeat(500);
    const capped = await capToolOutput(result(full), 'call/1', sessionId);

    expect(capped.content.startsWith('[Output truncated:')).toBe(true);
    expect(capped.content).not.toContain('z');
    const path = [...capped.content.matchAll(TOOL_OUTPUT_FILE_PATTERN)][0]?.[1];
    expect(path).toBe(`${sessionWorkspacePath(sessionId)}/default_bash-call_1.txt`);
    expect(await Bun.file(path as string).text()).toBe(full);
  });

  test('truncates without saving when there is no session', async () => {
    const capped = await capToolOutput(result('a'.repeat(TOOL_OUTPUT_MAX_CHARS + 1)), 'call-1');
    expect(capped.content).toContain('not saved');
    expect([...capped.content.matchAll(TOOL_OUTPUT_FILE_PATTERN)]).toHaveLength(0);
  });
});

describe('executeReadFullToolOutput', () => {
  test('pages through a saved output by characters', async () => {
    const full = 'x'.repeat(TOOL_OUTPUT_MAX_CHARS + 10);
    const capped = await capToolOutput(result(full), 'call-2', sessionId);
    const path = [...capped.content.matchAll(TOOL_OUTPUT_FILE_PATTERN)][0]?.[1] as string;

    const first = await executeReadFullToolOutput({ path, limit: 5 });
    expect(first).toStartWith('xxxxx\n\n(Showing chars 0-5');
    expect(first).toContain('offset=5');
    expect(await executeReadFullToolOutput({ path, offset: TOOL_OUTPUT_MAX_CHARS })).toBe('x'.repeat(10));
  });

  test('rejects paths outside the workspace', async () => {
    expect(executeReadFullToolOutput({ path: '/etc/passwd' })).rejects.toThrow('not a saved tool output');
  });
});
