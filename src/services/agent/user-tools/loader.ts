import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpTool, McpToolResult } from '../../../models/mcp';
import { USER_TOOL_SERVER, USER_TOOLS_DIR } from '../../../constants';
import type { UserToolDefinition } from '../../../models/agent';

export { USER_TOOLS_DIR };

let loaded = false;
let entries: UserToolDefinition[] = [];
/** Tool name -> the file in USER_TOOLS_DIR that defines it, for syncing tools to fl0w-work. */
let sourceFiles = new Map<string, string>();
let loadErrors: string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseModule = (mod: Record<string, unknown>, filePath: string): UserToolDefinition => {
  const candidate = isRecord(mod.default) ? mod.default : mod;

  const name = candidate.name;
  const description = candidate.description;
  const inputSchema = candidate.inputSchema;
  const execute = candidate.execute;

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`missing or invalid "name" export in ${filePath}`);
  }
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error(`missing or invalid "description" export in ${filePath}`);
  }
  if (!isRecord(inputSchema)) {
    throw new Error(`missing or invalid "inputSchema" export in ${filePath}`);
  }
  if (typeof execute !== 'function') {
    throw new Error(`missing or invalid "execute" export in ${filePath}`);
  }

  return {
    name: name.trim(),
    description: description.trim(),
    inputSchema,
    execute: execute as UserToolDefinition['execute'],
  };
};

export const loadUserTools = async (dir = USER_TOOLS_DIR) => {
  if (loaded) return { tools: entries, errors: loadErrors };

  loaded = true;
  entries = [];
  sourceFiles = new Map();
  loadErrors = [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    loadErrors.push(`failed to read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return { tools: entries, errors: loadErrors };
  }

  const tsFiles = files
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.startsWith('_'))
    .sort();

  for (const file of tsFiles) {
    const filePath = join(dir, file);
    try {
      const mod = await import(filePath);
      const definition = parseModule(mod as Record<string, unknown>, filePath);

      if (entries.some((entry) => entry.name === definition.name)) {
        loadErrors.push(`duplicate tool name "${definition.name}" in ${file}`);
        continue;
      }

      entries.push(definition);
      sourceFiles.set(definition.name, file);
    } catch (error) {
      loadErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (entries.length > 0) {
    console.log(`[user-tools] loaded ${entries.length} tool(s) from ${dir}: ${entries.map((e) => e.name).join(', ')}`);
  }
  if (loadErrors.length > 0) {
    console.error(`[user-tools] ${loadErrors.length} error(s):\n${loadErrors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return { tools: entries, errors: loadErrors };
};

const toolMap = () => new Map(entries.map((entry) => [entry.name, entry]));

export const listUserTools = (): McpTool[] =>
  entries.map((entry) => ({
    server: USER_TOOL_SERVER,
    name: entry.name,
    description: entry.description,
    inputSchema: entry.inputSchema,
  }));

export const isUserToolKey = (key: string) => key.startsWith(`${USER_TOOL_SERVER}/`);

export const getUserToolLoadErrors = () => [...loadErrors];

/** File name (relative to USER_TOOLS_DIR) of a loaded tool, or undefined if no loaded tool has that name. */
export const getUserToolSourceFile = (name: string) => sourceFiles.get(name);

export const executeUserTool = async (
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> => {
  const entry = toolMap().get(name);
  if (!entry) {
    return {
      server: USER_TOOL_SERVER,
      tool: name,
      isError: true,
      content: `Unknown user tool: ${name}`,
    };
  }

  try {
    const content = await entry.execute(args);
    return { server: USER_TOOL_SERVER, tool: name, isError: false, content };
  } catch (error) {
    return {
      server: USER_TOOL_SERVER,
      tool: name,
      isError: true,
      content: error instanceof Error ? error.message : String(error),
    };
  }
};
