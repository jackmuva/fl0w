import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { assertReadablePath, getWorkspaceDir, isPathWithinWorkspace } from './tool-utils';

export type GlobInput = {
  pattern: string;
  path?: string;
};

const globInputSchema = jsonSchema<GlobInput>({
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The glob pattern to match files against',
    },
    path: {
      type: 'string',
      description: 'The directory to search in. If not specified, the current working directory will be used. Must be a valid directory path if provided.',
    },
  },
  required: ['pattern'],
});

export const globDescription = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths
- Use this tool when you need to find files by name patterns
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.`;

export const executeGlob = async ({ pattern, path }: GlobInput): Promise<string> => {
  const workspace = resolve(getWorkspaceDir());
  const search = path ? await assertReadablePath(path) : workspace;

  try {
    const info = await stat(search);
    if (!info.isDirectory()) throw new Error(`glob path must be a directory: ${search}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('glob path must be')) throw error;
    throw new Error(`Directory not found: ${search}`);
  }

  const limit = 100;
  const glob = new Bun.Glob(pattern.startsWith('**/') ? pattern : `**/${pattern}`);
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: search, onlyFiles: true })) {
    const absolute = resolve(search, file);
    files.push(isPathWithinWorkspace(absolute, workspace) ? relative(workspace, absolute) : absolute);
    if (files.length >= limit) break;
  }

  if (files.length === 0) return 'No files found';

  const output = [...files];
  if (files.length >= limit) {
    output.push('');
    output.push(`(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`);
  }

  return output.join('\n');
};

export const globTool = tool({
  description: globDescription,
  inputSchema: globInputSchema,
  execute: executeGlob,
});

export const globToolSchema = globInputSchema.jsonSchema as Record<string, unknown>;
