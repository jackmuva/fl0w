import { readdir, stat } from 'node:fs/promises';
import { jsonSchema, tool } from 'ai';
import { assertReadablePath, getWorkspaceDir, pathExists } from './tool-utils';

export type ListDirInput = {
  path?: string;
  offset?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 200;

const listDirInputSchema = jsonSchema<ListDirInput>({
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Directory to list, relative to the current working directory. Omit to list the current directory.',
    },
    offset: {
      type: 'number',
      description: 'The entry index to start from (1-indexed, defaults to 1)',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of entries to return (defaults to 200)',
    },
  },
});

export const listDirDescription = `List entries in a directory from the local filesystem.

Usage:
- Omit path to list the current working directory.
- path may be relative (e.g. "src") or absolute within the workspace or a loaded skill's base directory.
- Returns one entry per line with a trailing / for subdirectories.
- Use offset and limit to paginate large directories.
- Use glob to find files by pattern; use list_dir to browse a known directory.
- Use read to view file contents.`;

export const executeListDir = async ({ path, offset = 1, limit = DEFAULT_LIMIT }: ListDirInput): Promise<string> => {
  const displayPath = path ?? '.';
  const resolved = await assertReadablePath(path ?? getWorkspaceDir());

  if (!(await pathExists(resolved))) {
    throw new Error(`Directory not found: ${displayPath}`);
  }

  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`Path is not a directory: ${displayPath}`);
  }

  const entries = await readdir(resolved, { withFileTypes: true });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  const start = Math.max(0, offset - 1);
  const slice = sorted.slice(start, start + limit);
  const lines = slice.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);

  if (lines.length === 0) return 'No entries found';

  const truncated = start + slice.length < sorted.length;
  const output = lines.join('\n');
  return truncated
    ? `${output}\n\n(Directory has ${sorted.length} entries. Use offset=${offset + limit} to list more.)`
    : output;
};

export const listDirTool = tool({
  description: listDirDescription,
  inputSchema: listDirInputSchema,
  execute: executeListDir,
});

export const listDirToolSchema = listDirInputSchema.jsonSchema as Record<string, unknown>;
