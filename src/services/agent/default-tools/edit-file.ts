import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { assertWithinWorkspace, pathExists } from './tool-utils';

export type EditFileInput = {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
};

const editFileInputSchema = jsonSchema<EditFileInput>({
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'Path to the file to modify, relative to the workspace root (e.g. "src/index.ts")',
    },
    oldString: {
      type: 'string',
      description: 'The text to replace',
    },
    newString: {
      type: 'string',
      description: 'The text to replace it with (must be different from oldString)',
    },
    replaceAll: {
      type: 'boolean',
      description: 'Replace all occurrences of oldString (default false)',
    },
  },
  required: ['filePath', 'oldString', 'newString'],
});

export const editFileDescription = `Performs exact string replacements in files.

Usage:
- When editing text from Read tool output, preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g. \`1: \`). Everything after that space is the actual file content to match.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- The edit will FAIL if oldString is not found in the file.
- The edit will FAIL if oldString is found multiple times unless replaceAll is true or oldString includes enough context to be unique.
- Use replaceAll for replacing and renaming strings across the file.`;

const replaceContent = (content: string, oldString: string, newString: string, replaceAll?: boolean) => {
  if (replaceAll) {
    const count = content.split(oldString).length - 1;
    if (count === 0) throw new Error('oldString not found in content');
    return content.replaceAll(oldString, newString);
  }

  const index = content.indexOf(oldString);
  if (index === -1) throw new Error('oldString not found in content');

  const second = content.indexOf(oldString, index + oldString.length);
  if (second !== -1) {
    throw new Error('Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match, or set replaceAll to true.');
  }

  return content.slice(0, index) + newString + content.slice(index + oldString.length);
};

export const executeEditFile = async ({ filePath, oldString, newString, replaceAll }: EditFileInput): Promise<string> => {
  if (oldString === newString) {
    throw new Error('No changes to apply: oldString and newString are identical.');
  }

  const resolved = await assertWithinWorkspace(filePath);
  const exists = await pathExists(resolved);

  if (oldString === '') {
    if (exists) {
      throw new Error('oldString cannot be empty when editing an existing file. Provide the exact text to replace.');
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, newString, 'utf-8');
    return 'Edit applied successfully (created new file).';
  }

  if (!exists) throw new Error(`File not found: ${filePath}`);

  const content = await readFile(resolved, 'utf-8');
  const updated = replaceContent(content, oldString, newString, replaceAll);
  await writeFile(resolved, updated, 'utf-8');
  return 'Edit applied successfully.';
};

export const editFileTool = tool({
  description: editFileDescription,
  inputSchema: editFileInputSchema,
  execute: executeEditFile,
});

export const editFileToolSchema = editFileInputSchema.jsonSchema as Record<string, unknown>;
