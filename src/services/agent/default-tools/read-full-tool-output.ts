import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { TOOL_OUTPUT_MAX_CHARS, WORKSPACE_DIR } from '../../../constants';
import { isPathWithinWorkspace, pathExists, READ_FULL_TOOL_OUTPUT_TOOL } from './tool-utils';

/** Matches the spill notice (and compaction's file list) so saved paths survive summaries. */
export const TOOL_OUTPUT_FILE_PATTERN = /Full output saved to (\S+\.txt)/g;

export const toolOutputFileNotice = (path: string) =>
  `Full output saved to ${path} (read it with ${READ_FULL_TOOL_OUTPUT_TOOL})`;

export type ReadFullToolOutputInput = {
  path: string;
  offset?: number;
  limit?: number;
};

const readFullToolOutputInputSchema = jsonSchema<ReadFullToolOutputInput>({
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'The saved output path from a truncated tool result ("Full output saved to <path>")',
    },
    offset: {
      type: 'number',
      description: 'The character offset to start reading from (0-indexed, defaults to 0)',
    },
    limit: {
      type: 'number',
      description: 'The maximum number of characters to read (defaults to the tool output cap)',
    },
  },
  required: ['path'],
});

export const readFullToolOutputDescription = `Read the full output of a tool call that was truncated because it was too long.

Usage:
- Truncated tool results start with "[Output truncated: ... Full output saved to <path> ...]". Pass that path here.
- Output is paged by characters: use offset to read later sections.
- Prefer reading only the sections you need; large outputs bloat the context window.`;

export const executeReadFullToolOutput = async ({ path, offset = 0, limit }: ReadFullToolOutputInput): Promise<string> => {
  const resolved = resolve(path.trim().replace(/^['"]|['"]$/g, ''));
  if (!isPathWithinWorkspace(resolved, resolve(WORKSPACE_DIR))) {
    throw new Error(`Path is not a saved tool output: ${path}`);
  }
  if (!(await pathExists(resolved))) throw new Error(`Saved tool output not found: ${path}`);

  const content = await readFile(resolved, 'utf-8');
  const start = Math.max(0, Math.floor(offset));
  const end = Math.min(content.length, start + Math.max(1, Math.floor(limit ?? TOOL_OUTPUT_MAX_CHARS)));
  const slice = content.slice(start, end);
  if (end >= content.length) return slice;
  return `${slice}\n\n(Showing chars ${start}-${end} of ${content.length}. Use offset=${end} to read more.)`;
};

export const readFullToolOutputTool = tool({
  description: readFullToolOutputDescription,
  inputSchema: readFullToolOutputInputSchema,
  execute: executeReadFullToolOutput,
});

export const readFullToolOutputToolSchema = readFullToolOutputInputSchema.jsonSchema as Record<string, unknown>;
