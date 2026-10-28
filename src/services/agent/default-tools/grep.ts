import { dirname, isAbsolute, join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { jsonSchema, tool } from 'ai';
import { getWorkspaceDir, resolveWorkspacePath } from './tool-utils';

export type GrepInput = {
  pattern: string;
  path?: string;
  include?: string;
};

const grepInputSchema = jsonSchema<GrepInput>({
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The regex pattern to search for in file contents',
    },
    path: {
      type: 'string',
      description: 'The directory to search in. Defaults to the current working directory.',
    },
    include: {
      type: 'string',
      description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
    },
  },
  required: ['pattern'],
});

export const grepDescription = `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with matching lines
- Use this tool when you need to find files containing specific patterns`;

type RipgrepMatch = {
  path: string;
  line: number;
  text: string;
};

const runRipgrep = async (cwd: string, pattern: string, include?: string, limit = 100): Promise<RipgrepMatch[]> => {
  const args = ['--json', '--line-number', '--no-heading', pattern];
  if (include) args.push('--glob', include);
  args.push(cwd);

  const proc = Bun.spawn(['rg', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const matches: RipgrepMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string, data?: { path?: { text?: string }, line_number?: number, lines?: { text?: string } } };
      if (parsed.type !== 'match' || !parsed.data?.path?.text) continue;
      matches.push({
        path: parsed.data.path.text,
        line: parsed.data.line_number ?? 0,
        text: parsed.data.lines?.text?.replace(/\n$/, '') ?? '',
      });
      if (matches.length >= limit) break;
    } catch {
      continue;
    }
  }
  return matches;
};

export const executeGrep = async ({ pattern, path, include }: GrepInput): Promise<string> => {
  if (!pattern) throw new Error('pattern is required');

  const workspace = getWorkspaceDir();
  const requested = path
    ? (isAbsolute(path) ? resolve(path) : join(workspace, path))
    : workspace;

  let searchPath = requested;
  try {
    const info = await stat(requested);
    if (!info.isDirectory()) searchPath = dirname(requested);
  } catch {
    throw new Error(`Path not found: ${path ?? workspace}`);
  }

  const matches = await runRipgrep(searchPath, pattern, include);
  if (matches.length === 0) return 'No files found';

  const output: string[] = [`Found ${matches.length} matches${matches.length >= 100 ? ' (results may be truncated)' : ''}`];
  let current = '';
  for (const match of matches) {
    const displayPath = resolveWorkspacePath(match.path);
    if (current !== displayPath) {
      if (current) output.push('');
      current = displayPath;
      output.push(`${displayPath}:`);
    }
    output.push(`  Line ${match.line}: ${match.text}`);
  }

  if (matches.length >= 100) {
    output.push('');
    output.push('(Results truncated. Consider using a more specific path or pattern.)');
  }

  return output.join('\n');
};

export const grepTool = tool({
  description: grepDescription,
  inputSchema: grepInputSchema,
  execute: executeGrep,
});

export const grepToolSchema = grepInputSchema.jsonSchema as Record<string, unknown>;
