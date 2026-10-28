import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { jsonSchema, tool } from 'ai';
import { deriveNewContentsFromChunks, parsePatch, type Hunk } from './patch-parser';
import { assertWithinWorkspace, getWorkspaceDir, pathExists } from './tool-utils';

export type ApplyPatchInput = {
  patchText: string;
};

const applyPatchInputSchema = jsonSchema<ApplyPatchInput>({
  type: 'object',
  properties: {
    patchText: {
      type: 'string',
      description: 'The full patch text that describes all changes to be made',
    },
  },
  required: ['patchText'],
});

export const applyPatchDescription = `Use the apply_patch tool to edit files. Your patch language is a stripped-down, file-oriented diff format designed to be easy to parse and safe to apply.

*** Begin Patch
[ one or more file sections ]
*** End Patch

Each operation starts with one of three headers:

*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).
*** Delete File: <path> - remove an existing file. Nothing follows.
*** Update File: <path> - patch an existing file in place (optionally with a rename via *** Move to:).

Example:
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch

Notes:
- You must include a header with your intended action (Add/Delete/Update)
- Prefix new lines with + even when creating a new file
- Prefer apply_patch for multi-file or multi-hunk changes; use edit for small single replacements`;

type FileChange = {
  filePath: string;
  newContent: string;
  type: 'add' | 'update' | 'delete' | 'move';
  movePath?: string;
};

const relativePath = (filePath: string) =>
  relative(getWorkspaceDir(), filePath).replaceAll('\\', '/');

const planChanges = async (hunks: Hunk[]): Promise<FileChange[]> => {
  const changes: FileChange[] = [];

  for (const hunk of hunks) {
    const filePath = await assertWithinWorkspace(hunk.path);

    switch (hunk.type) {
      case 'add': {
        const newContent =
          hunk.contents.length === 0 || hunk.contents.endsWith('\n')
            ? hunk.contents
            : `${hunk.contents}\n`;
        if (await pathExists(filePath)) {
          throw new Error(`apply_patch verification failed: file already exists: ${hunk.path}`);
        }
        changes.push({ filePath, newContent, type: 'add' });
        break;
      }

      case 'delete': {
        if (!(await pathExists(filePath))) {
          throw new Error(`apply_patch verification failed: file not found for deletion: ${hunk.path}`);
        }
        changes.push({ filePath, newContent: '', type: 'delete' });
        break;
      }

      case 'update': {
        let info;
        try {
          info = await stat(filePath);
        } catch {
          throw new Error(`apply_patch verification failed: Failed to read file to update: ${hunk.path}`);
        }
        if (!info.isFile()) {
          throw new Error(`apply_patch verification failed: path is not a file: ${hunk.path}`);
        }

        const oldContent = await readFile(filePath, 'utf-8');
        const newContent = deriveNewContentsFromChunks(filePath, hunk.chunks, oldContent);
        const movePath = hunk.move_path
          ? await assertWithinWorkspace(hunk.move_path)
          : undefined;

        changes.push({
          filePath,
          newContent,
          type: movePath ? 'move' : 'update',
          movePath,
        });
        break;
      }
    }
  }

  return changes;
};

const applyChanges = async (changes: FileChange[]) => {
  for (const change of changes) {
    switch (change.type) {
      case 'add':
      case 'update':
        await mkdir(dirname(change.filePath), { recursive: true });
        await writeFile(change.filePath, change.newContent, 'utf-8');
        break;

      case 'move': {
        if (!change.movePath) throw new Error('move change missing movePath');
        await mkdir(dirname(change.movePath), { recursive: true });
        await writeFile(change.movePath, change.newContent, 'utf-8');
        await rm(change.filePath);
        break;
      }

      case 'delete':
        await rm(change.filePath);
        break;
    }
  }
};

export const executeApplyPatch = async ({ patchText }: ApplyPatchInput): Promise<string> => {
  if (!patchText) throw new Error('patchText is required');

  let hunks;
  try {
    hunks = parsePatch(patchText).hunks;
  } catch (error) {
    throw new Error(`apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (hunks.length === 0) {
    throw new Error('apply_patch verification failed: no hunks found');
  }

  const changes = await planChanges(hunks);
  await applyChanges(changes);

  const summaryLines = changes.map((change) => {
    if (change.type === 'add') return `A ${relativePath(change.filePath)}`;
    if (change.type === 'delete') return `D ${relativePath(change.filePath)}`;
    const target = change.movePath ?? change.filePath;
    return `M ${relativePath(target)}`;
  });

  return `Success. Updated the following files:\n${summaryLines.join('\n')}`;
};

export const applyPatchTool = tool({
  description: applyPatchDescription,
  inputSchema: applyPatchInputSchema,
  execute: executeApplyPatch,
});

export const applyPatchToolSchema = applyPatchInputSchema.jsonSchema as Record<string, unknown>;
