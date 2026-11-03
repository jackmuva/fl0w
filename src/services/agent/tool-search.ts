import { jsonSchema, tool, type ModelMessage, type PrepareStepFunction, type ToolSet } from 'ai';
import { mcpToolKey, type McpTool } from '../../models/mcp';
import { TOOL_SEARCH_CATALOG_TOKENS, TOOL_SEARCH_DEFAULT_LIMIT, TOOL_SEARCH_THRESHOLD_TOKENS } from '../../constants';
import { activeWorkflowStore } from '../../store/active-workflow-store';
import { estimateTextTokens } from './hooks/compaction';
import { DEFAULT_TOOL_SERVER, defaultToolKey } from './default-tools/tool-utils';

/** Deferred (non-default) tools hide behind this tool once their schemas outgrow TOOL_SEARCH_THRESHOLD_TOKENS. */
export const SEARCH_TOOLS_TOOL = defaultToolKey('search_tools');

export type ToolOptions = {
  tools: ToolSet;
  prepareStep?: PrepareStepFunction<ToolSet>;
};

type SearchInput = { query?: string; names?: string[]; server?: string; limit?: number };
type SearchResult = { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>; remaining: number; note: string };

const DESCRIPTION_LIMIT = 120;

const toolText = (entry: McpTool) =>
  `${mcpToolKey(entry)}: ${JSON.stringify({ description: entry.description ?? '', inputSchema: entry.inputSchema })}`;

const tokenize = (text: string): string[] =>
  text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 0);

// Crude plural folding so "issues" finds "create_issue".
const termForms = (term: string): string[] => [
  term,
  ...(term.endsWith('es') && term.length > 3 ? [term.slice(0, -2)] : []),
  ...(term.endsWith('s') && term.length > 2 ? [term.slice(0, -1)] : []),
];

const firstLine = (description: string | undefined) => {
  const line = description?.split('\n', 1)[0]?.trim() ?? '';
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 3)}...` : line;
};

const schemaText = (schema: Record<string, unknown>): string => {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return '';
  return Object.entries(properties as Record<string, { description?: unknown }>)
    .map(([name, property]) => `${name} ${typeof property?.description === 'string' ? property.description : ''}`)
    .join('\n');
};

/** Lexical ranking (opencode Code Mode's weights): exact name > name word > name substring > description > schema text. */
export const rankTools = (entries: McpTool[], query: string): McpTool[] => {
  const terms = tokenize(query).map(termForms);
  if (terms.length === 0) return entries;
  return entries
    .map((entry) => {
      const key = mcpToolKey(entry).toLowerCase();
      const name = entry.name.toLowerCase();
      const words = tokenize(mcpToolKey(entry));
      const description = (entry.description ?? '').toLowerCase();
      const text = `${key}\n${description}\n${schemaText(entry.inputSchema)}`.toLowerCase();
      const score = terms.reduce((total, forms) => total
        + (forms.some((form) => name === form || key === form) ? 20 : 0)
        + (forms.some((form) => words.includes(form)) ? 12 : 0)
        + (forms.some((form) => key.includes(form)) ? 8 : 0)
        + (forms.some((form) => description.includes(form)) ? 4 : 0)
        + (forms.some((form) => text.includes(form)) ? 2 : 0), 0);
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || mcpToolKey(left.entry).localeCompare(mcpToolKey(right.entry)))
    .map(({ entry }) => entry);
};

/** Every server gets a header line; tool lines are added one per server per round, shortest first, until the budget runs out. */
export const renderCatalog = (entries: McpTool[], budget = TOOL_SEARCH_CATALOG_TOKENS): string => {
  const servers = [...Map.groupBy(entries, (entry) => entry.server)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([server, tools]) => ({
      server,
      lines: tools
        .map((entry) => {
          const summary = firstLine(entry.description);
          return `  - ${mcpToolKey(entry)}${summary ? ` // ${summary}` : ''}`;
        })
        .sort((left, right) => left.length - right.length || left.localeCompare(right)),
      shown: [] as string[],
    }));

  const header = (server: (typeof servers)[number]) => {
    const count = server.lines.length === 1 ? '1 tool' : `${server.lines.length} tools`;
    const shown = server.shown.length === server.lines.length ? '' : `, ${server.shown.length} shown`;
    return `- ${server.server} (${count}${shown})`;
  };

  let remaining = budget - servers.reduce((total, server) => total + estimateTextTokens(header(server)), 0);
  const active = new Set(servers);
  while (active.size > 0) {
    for (const server of active) {
      const line = server.lines[server.shown.length];
      const cost = line === undefined ? Infinity : estimateTextTokens(line);
      if (cost > remaining) {
        active.delete(server);
        continue;
      }
      server.shown.push(line!);
      remaining -= cost;
      if (server.shown.length === server.lines.length) active.delete(server);
    }
  }

  return servers
    .flatMap((server) => [header(server), ...server.shown.sort()])
    .join('\n');
};

export const searchTools = (entries: McpTool[], input: SearchInput): SearchResult => {
  const limit = Math.max(1, input.limit ?? TOOL_SEARCH_DEFAULT_LIMIT);
  const scoped = input.server ? entries.filter((entry) => entry.server === input.server) : entries;
  const byKey = new Map(scoped.map((entry) => [mcpToolKey(entry), entry]));
  const exact = (input.names ?? []).map((name) => byKey.get(name.trim())).filter((entry): entry is McpTool => entry !== undefined);
  const query = input.query?.trim() ?? '';
  const exactQuery = byKey.get(query);
  const ranked = exact.length > 0 || exactQuery ? [...exact, ...(exactQuery ? [exactQuery] : [])] : rankTools(scoped, query);
  const matches = [...new Set(ranked)];
  const shown = matches.slice(0, limit);
  return {
    tools: shown.map((entry) => ({
      name: mcpToolKey(entry),
      description: entry.description ?? '',
      inputSchema: entry.inputSchema,
    })),
    remaining: matches.length - shown.length,
    note: shown.length === 0
      ? 'No matching tools. Try other keywords, a server filter, or check the catalog in this tool\'s description.'
      : 'These tools are now callable directly by name.',
  };
};

const searchToolDescription = (catalog: string, partial: boolean) => `Find and load tools that are not yet callable. Matching tools are returned with full input schemas and become callable by name on your next step.

Search by keywords (\`query\`), by exact tool names (\`names\`), and optionally restrict to one \`server\`. Do not guess tool names or call a listed tool before loading it.
${partial ? '\nThe catalog below is partial: some servers list only a few of their tools. Search to find the rest.\n' : ''}
Available tools to load:
${catalog}`;

const searchToolSchema = jsonSchema<SearchInput>({
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Keywords describing the capability, e.g. "create github issue", or an exact tool name' },
    names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names (server__name) to load' },
    server: { type: 'string', description: 'Only search tools from this server' },
    limit: { type: 'number', description: `Max tools to return (default ${TOOL_SEARCH_DEFAULT_LIMIT})` },
  },
});

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/** Deferred tools the conversation has already loaded via search_tools or called before (e.g. in an earlier phase). */
export const loadedToolKeys = (messages: ModelMessage[], deferred: Set<string>): Set<string> => {
  const loaded = new Set<string>();
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type === 'tool-call' && deferred.has(part.toolName)) loaded.add(part.toolName);
      if (part.type !== 'tool-result' || part.toolName !== SEARCH_TOOLS_TOOL || !('value' in part.output)) continue;
      const result = parseJson(part.output.value) as Partial<SearchResult> | undefined;
      for (const found of result?.tools ?? []) if (deferred.has(found.name)) loaded.add(found.name);
    }
  }
  return loaded;
};

/** Defers non-default tools behind search_tools when their schemas exceed the threshold; otherwise passes tools through. */
export const withToolSearch = (entries: McpTool[], tools: ToolSet): ToolOptions => {
  const deferred = entries.filter((entry) => entry.server !== DEFAULT_TOOL_SERVER);
  const tokens = deferred.reduce((total, entry) => total + estimateTextTokens(toolText(entry)), 0);
  if (deferred.length === 0 || tokens <= TOOL_SEARCH_THRESHOLD_TOKENS) return { tools };

  const deferredKeys = new Set(deferred.map(mcpToolKey));
  const direct = Object.keys(tools).filter((key) => !deferredKeys.has(key));
  const catalog = renderCatalog(deferred);
  const partial = catalog.split('\n').filter((line) => line.startsWith('  - ')).length < deferred.length;
  const workflowKeys = (activeWorkflowStore.get()?.workflow.steps ?? [])
    .flatMap((step) => step.tools ?? [])
    .map((call) => call.tool)
    .filter((key) => deferredKeys.has(key));

  return {
    tools: {
      ...tools,
      [SEARCH_TOOLS_TOOL]: tool({
        description: searchToolDescription(catalog, partial),
        inputSchema: searchToolSchema,
        execute: async (input) => searchTools(deferred, input),
      }),
    },
    prepareStep: ({ messages }) => ({
      activeTools: [...new Set([...direct, SEARCH_TOOLS_TOOL, ...workflowKeys, ...loadedToolKeys(messages, deferredKeys)])],
    }),
  };
};
