import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { assertWithinWorkspace, pathExists } from './tool-utils';

export type WriteFileInput = {
  filePath: string;
  content: string;
};

const writeFileInputSchema = jsonSchema<WriteFileInput>({
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'Path to the file to write, relative to the workspace root (e.g. "src/index.ts")',
    },
    content: {
      type: 'string',
      description: 'The content to write to the file',
    },
  },
  required: ['filePath', 'content'],
});

export const writeFileDescription = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;

export const executeWriteFile = async ({ filePath, content }: WriteFileInput): Promise<string> => {
  const resolved = await assertWithinWorkspace(filePath);
  const exists = await pathExists(resolved);

  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf-8');

  return exists ? 'Wrote file successfully (overwrote existing file).' : 'Wrote file successfully (created new file).';
};

export const writeFileTool = tool({
  description: writeFileDescription,
  inputSchema: writeFileInputSchema,
  execute: executeWriteFile,
});

export const writeFileToolSchema = writeFileInputSchema.jsonSchema as Record<string, unknown>;
