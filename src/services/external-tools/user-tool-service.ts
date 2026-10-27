import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpTool, McpToolResult } from '../../models/mcp';
import { USER_TOOL_SERVER, USER_TOOLS_DIR } from '../../constants';
import type { UserToolDefinition } from '../../models/agent';

export { USER_TOOLS_DIR };

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

export const isUserToolKey = (key: string) => key.startsWith(`${USER_TOOL_SERVER}/`);

class UserToolLoader {
  private loaded = false;
  private entries: UserToolDefinition[] = [];
  /** Tool name -> the file in USER_TOOLS_DIR that defines it, for syncing tools to fl0w-work. */
  private sourceFiles = new Map<string, string>();
  private loadErrors: string[] = [];

  async loadUserTools(dir = USER_TOOLS_DIR) {
    if (this.loaded) return { tools: this.entries, errors: this.loadErrors };

    this.loaded = true;
    this.entries = [];
    this.sourceFiles = new Map();
    this.loadErrors = [];

    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      this.loadErrors.push(`failed to read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      return { tools: this.entries, errors: this.loadErrors };
    }

    const tsFiles = files
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.startsWith('_'))
      .sort();

    for (const file of tsFiles) {
      const filePath = join(dir, file);
      try {
        const mod = await import(filePath);
        const definition = parseModule(mod as Record<string, unknown>, filePath);

        if (this.entries.some((entry) => entry.name === definition.name)) {
          this.loadErrors.push(`duplicate tool name "${definition.name}" in ${file}`);
          continue;
        }

        this.entries.push(definition);
        this.sourceFiles.set(definition.name, file);
      } catch (error) {
        this.loadErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.entries.length > 0) {
      console.error(`[user-tools] loaded ${this.entries.length} tool(s) from ${dir}: ${this.entries.map((e) => e.name).join(', ')}`);
    }
    if (this.loadErrors.length > 0) {
      console.error(`[user-tools] ${this.loadErrors.length} error(s):\n${this.loadErrors.map((e) => `  - ${e}`).join('\n')}`);
    }

    return { tools: this.entries, errors: this.loadErrors };
  }

  listUserTools(): McpTool[] {
    return this.entries.map((entry) => ({
      server: USER_TOOL_SERVER,
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
    }));
  }

  getUserToolLoadErrors() {
    return [...this.loadErrors];
  }

  /** File name (relative to USER_TOOLS_DIR) of a loaded tool, or undefined if no loaded tool has that name. */
  getUserToolSourceFile(name: string) {
    return this.sourceFiles.get(name);
  }

  async executeUserTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolResult> {
    const entry = new Map(this.entries.map((e) => [e.name, e])).get(name);
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
  }
}

export const userToolLoader = new UserToolLoader();
