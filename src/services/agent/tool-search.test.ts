import { describe, expect, test } from 'bun:test';
import type { ModelMessage, ToolSet } from 'ai';
import type { McpTool } from '../../models/mcp';
import { loadedToolKeys, rankTools, renderCatalog, SEARCH_TOOLS_TOOL, searchTools, withToolSearch } from './tool-search';

const mcp = (server: string, name: string, description = '', properties: Record<string, unknown> = {}): McpTool => ({
  server,
  name,
  description,
  inputSchema: { type: 'object', properties },
});

const tools: McpTool[] = [
  mcp('github', 'create_issue', 'Create a new issue in a repository', { title: { type: 'string' } }),
  mcp('github', 'list_pull_requests', 'List pull requests'),
  mcp('github', 'create_issue_comment', 'Comment on an issue'),
  mcp('slack', 'post_message', 'Send a message to a channel', { channel: { type: 'string', description: 'Channel id' } }),
];

describe('rankTools', () => {
  test('ranks name matches above description matches and folds plurals', () => {
    expect(rankTools(tools, 'create issues').map((entry) => entry.name).slice(0, 2)).toEqual(['create_issue', 'create_issue_comment']);
  });

  test('finds tools by schema property text', () => {
    expect(rankTools(tools, 'channel').map((entry) => entry.name)).toEqual(['post_message']);
  });

  test('drops tools with no match', () => {
    expect(rankTools(tools, 'calendar')).toEqual([]);
  });
});

describe('searchTools', () => {
  test('returns schemas for exact names and reports remaining matches', () => {
    expect(searchTools(tools, { names: ['slack__post_message'] }).tools.map((entry) => entry.name)).toEqual(['slack__post_message']);
    const result = searchTools(tools, { query: 'issue', limit: 1 });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.inputSchema).toBeDefined();
    expect(result.remaining).toBe(1);
  });

  test('restricts to a server', () => {
    expect(searchTools(tools, { query: 'message', server: 'github' }).tools).toEqual([]);
  });
});

describe('renderCatalog', () => {
  test('lists every server and trims tool lines to the budget', () => {
    const many = Array.from({ length: 200 }, (_, index) => mcp('big', `tool_${index}`, 'Does a thing'));
    const catalog = renderCatalog([...many, ...tools], 300);
    expect(catalog).toContain('- big (200 tools,');
    expect(catalog).toContain('- github (3 tools');
    expect(catalog).toContain('- slack (1 tool');
    expect(catalog.split('\n').length).toBeLessThan(100);
  });
});

describe('loadedToolKeys', () => {
  test('collects tools returned by search_tools and tools already called', () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'slack__post_message', input: {} }] },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: '2',
          toolName: SEARCH_TOOLS_TOOL,
          output: { type: 'json', value: { tools: [{ name: 'github__create_issue', description: '', inputSchema: {} }], remaining: 0, note: '' } },
        }],
      },
    ];
    const deferred = new Set(['slack__post_message', 'github__create_issue', 'github__list_pull_requests']);
    expect([...loadedToolKeys(messages, deferred)].sort()).toEqual(['github__create_issue', 'slack__post_message']);
  });
});

describe('withToolSearch', () => {
  const toolSet = (entries: McpTool[]) => Object.fromEntries(entries.map((entry) => [`${entry.server}__${entry.name}`, {}])) as ToolSet;

  test('passes small tool sets through unchanged', () => {
    const result = withToolSearch(tools, toolSet(tools));
    expect(result.prepareStep).toBeUndefined();
    expect(Object.keys(result.tools)).not.toContain(SEARCH_TOOLS_TOOL);
  });

  test('defers large tool sets behind search_tools', async () => {
    const big = Array.from({ length: 300 }, (_, index) => mcp('big', `tool_${index}`, 'x'.repeat(200)));
    const entries = [mcp('default', 'read', 'Read a file'), ...big];
    const result = withToolSearch(entries, toolSet(entries));
    const step = await result.prepareStep!({ messages: [] } as unknown as Parameters<NonNullable<typeof result.prepareStep>>[0]);
    expect(step?.activeTools).toEqual(['default__read', SEARCH_TOOLS_TOOL]);
  });
});
