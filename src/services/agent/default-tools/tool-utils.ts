import { join, resolve, isAbsolute, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { skillService } from '../../external-tools/skill-service';

export const DEFAULT_TOOL_SERVER = 'default';

export const defaultToolKey = (name: string) => `${DEFAULT_TOOL_SERVER}/${name}`;

export const DEFAULT_CREATE_PLAN_TOOL = defaultToolKey('create_plan');
export const DEFAULT_MARK_STEP_COMPLETE_TOOL = defaultToolKey('mark_step_complete');

export const READ_FULL_TOOL_OUTPUT_TOOL = defaultToolKey('read_full_tool_output');
export const DEFAULT_ASK_QUESTION_TOOL = defaultToolKey('ask_question');

export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 30_000;

const PROJECT_ROOT_MARKERS = new Set([
  'src', 'lib', 'test', 'tests', 'docs', 'config', 'public', 'assets', 'scripts',
  'node_modules', '.github', '.cursor', 'dist', 'build', 'app', 'packages',
]);

export const getWorkspaceDir = () => process.cwd();

export const isPathWithinWorkspace = (
  resolvedPath: string,
  workspace = resolve(getWorkspaceDir()),
) => {
  const rel = relative(workspace, resolve(resolvedPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const looksLikeProjectRelativeAbsolute = (filePath: string) => {
  const stripped = filePath.replace(/^\/+/, '');
  const firstSegment = stripped.split(/[/\\]/)[0] ?? '';
  return PROJECT_ROOT_MARKERS.has(firstSegment) || firstSegment.includes('.');
};

export const resolveWorkspacePath = (filePath: string) => {
  const workspace = resolve(getWorkspaceDir());
  const trimmed = filePath.trim().replace(/^['"]|['"]$/g, '');

  if (!isAbsolute(trimmed)) {
    return resolve(workspace, trimmed);
  }

  const resolved = resolve(trimmed);
  if (isPathWithinWorkspace(resolved, workspace)) {
    return resolved;
  }

  // Models often pass "/src/foo.ts" meaning workspace-relative, not a filesystem-root path.
  if (looksLikeProjectRelativeAbsolute(trimmed)) {
    const remapped = resolve(workspace, trimmed.replace(/^\/+/, ''));
    if (isPathWithinWorkspace(remapped, workspace)) {
      return remapped;
    }
  }

  return resolved;
};

export const assertWithinWorkspace = async (filePath: string) => {
  const workspace = resolve(getWorkspaceDir());
  const resolved = resolveWorkspacePath(filePath);
  if (!isPathWithinWorkspace(resolved, workspace)) {
    throw new Error(
      `Path is outside the workspace: ${filePath}\n` +
      `Workspace root: ${workspace}\n` +
      `Use paths relative to the workspace (e.g. "src/index.ts"), not root-relative paths like "/src/index.ts".`,
    );
  }
  return resolved;
};

export const isPathWithinSkillDir = (resolvedPath: string) =>
  skillService.getActiveSkillDirs().some((dir) => isPathWithinWorkspace(resolvedPath, dir));

export const assertReadablePath = async (filePath: string) => {
  const resolved = resolveWorkspacePath(filePath);
  if (isPathWithinSkillDir(resolved)) return resolved;
  return assertWithinWorkspace(filePath);
};

export const pathExists = async (filePath: string) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const truncateOutput = (text: string, maxLines = MAX_OUTPUT_LINES, maxBytes = MAX_OUTPUT_BYTES) => {
  const lines = text.split('\n');
  let truncated = false;
  let output = text;

  if (lines.length > maxLines) {
    output = lines.slice(0, maxLines).join('\n');
    truncated = true;
  }

  if (Buffer.byteLength(output, 'utf-8') > maxBytes) {
    let size = 0;
    const kept: string[] = [];
    for (const line of output.split('\n')) {
      const lineSize = Buffer.byteLength(line, 'utf-8') + 1;
      if (size + lineSize > maxBytes) break;
      kept.push(line);
      size += lineSize;
    }
    output = kept.join('\n');
    truncated = true;
  }

  if (truncated) {
    output += `\n\n(Output truncated to ${maxLines} lines / ${maxBytes} bytes.)`;
  }

  return output;
};

export const formatLineNumbered = (content: string, offset: number) =>
  content.split('\n').map((line, index) => {
    const truncated = line.length > 2000 ? `${line.slice(0, 2000)}... (line truncated to 2000 chars)` : line;
    return `${offset + index}: ${truncated}`;
  }).join('\n');

export const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const mimeFromExtension = (filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
};

export const joinPath = join;
