import { jsonSchema, tool } from 'ai';
import { resolveWorkspacePath, truncateOutput } from './tool-utils';

export type BashInput = {
  command: string;
  timeout?: number;
  workdir?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const bashInputSchema = jsonSchema<BashInput>({
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'The command to execute',
    },
    timeout: {
      type: 'number',
      description: 'Optional timeout in milliseconds',
    },
    workdir: {
      type: 'string',
      description: 'The working directory to run the command in. Defaults to the current directory. Use this instead of cd commands.',
    },
  },
  required: ['command'],
});

export const bashDescription = `Executes a given bash command with optional timeout, ensuring proper handling and security measures.

All commands run in the current working directory by default. Use the workdir parameter if you need to run a command in a different directory. AVOID using cd <directory> && <command> patterns - use workdir instead.

Before executing the command:
- Quote file paths that contain spaces with double quotes
- If commands depend on each other, chain them with && in a single call
- Prefer dedicated tools over bash for file search (Glob), content search (Grep), reading (Read), and editing (Edit)
- DO NOT use newlines to separate commands`;

export const executeBash = async ({ command, timeout, workdir }: BashInput): Promise<string> => {
  const cwd = workdir ? resolveWorkspacePath(workdir) : process.cwd();
  const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  const proc = Bun.spawn(['bash', '-lc', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });

  const timer = setTimeout(() => proc.kill(), timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timer);

  const parts: string[] = [];
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(stderr);
  if (exitCode !== 0) parts.push(`Exit code: ${exitCode}`);

  return truncateOutput(parts.join('\n').trim() || '(no output)');
};

export const bashTool = tool({
  description: bashDescription,
  inputSchema: bashInputSchema,
  execute: executeBash,
});

export const bashToolSchema = bashInputSchema.jsonSchema as Record<string, unknown>;
