import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { jsonSchema, tool } from 'ai';
import {
  assertWithinWorkspace,
  formatLineNumbered,
  IMAGE_MIMES,
  mimeFromExtension,
  pathExists,
} from './utils';

export type ReadFileInput = {
  filePath: string;
  offset?: number;
  limit?: number;
};

const DEFAULT_READ_LIMIT = 2000;

const readFileInputSchema = jsonSchema<ReadFileInput>({
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'Path to the file or directory, relative to the workspace root (e.g. "src/index.ts")',
    },
    offset: {
      type: 'number',
      description: 'The line number to start reading from (1-indexed)',
    },
    limit: {
      type: 'number',
      description: 'The maximum number of lines to read (defaults to 2000)',
    },
  },
  required: ['filePath'],
});

export const readFileDescription = `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- Prefer workspace-relative paths (e.g. "src/index.ts"). Do not use root-relative paths like "/src/index.ts".
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as \`<line>: <content>\`.
- Any line longer than 2000 characters is truncated.
- This tool can read image files (jpeg, png, gif, webp) and return them as base64 data URLs.`;

export const executeReadFile = async ({ filePath, offset = 1, limit = DEFAULT_READ_LIMIT }: ReadFileInput): Promise<string> => {
  const resolved = await assertWithinWorkspace(filePath);

  if (!(await pathExists(resolved))) {
    const dir = dirname(resolved);
    const base = basename(resolved);
    if (await pathExists(dir)) {
      const entries = await readdir(dir);
      const suggestions = entries
        .filter((entry) =>
          entry.toLowerCase().includes(base.toLowerCase()) ||
          base.toLowerCase().includes(entry.toLowerCase()),
        )
        .slice(0, 3)
        .map((entry) => join(dir, entry));
      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`);
      }
    }
    throw new Error(`File not found: ${filePath}`);
  }

  const info = await stat(resolved);
  if (info.isDirectory()) {
    const entries = await readdir(resolved, { withFileTypes: true });
    const start = Math.max(0, offset - 1);
    const slice = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(start, start + limit)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
    const truncated = start + slice.length < entries.length;
    const output = slice.length > 0 ? slice.join('\n') : 'No entries found';
    return truncated ? `${output}\n\n(Directory listing truncated.)` : output;
  }

  const mime = mimeFromExtension(resolved);
  if (mime && IMAGE_MIMES.has(mime)) {
    const bytes = await readFile(resolved);
    return `Image (${mime}, ${bytes.byteLength} bytes)\n[image:${resolved}]`;
  }

  const content = await readFile(resolved, 'utf-8');
  const lines = content.split('\n');
  const start = Math.max(0, offset - 1);
  const slice = lines.slice(start, start + limit);
  const formatted = formatLineNumbered(slice.join('\n'), offset);
  const truncated = start + slice.length < lines.length;

  if (truncated) {
    return `${formatted}\n\n(File has ${lines.length} total lines. Use offset=${offset + limit} to read more.)`;
  }
  return formatted;
};

export const readFileTool = tool({
  description: readFileDescription,
  inputSchema: readFileInputSchema,
  execute: executeReadFile,
});

export const readFileToolSchema = readFileInputSchema.jsonSchema as Record<string, unknown>;
