import type { ModelMessage } from 'ai';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'path';
import { FL0W_HOME } from '../../../constants';
import { isCapabilityEnabled } from '../capabilities';

export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const SKILL_FILENAME = 'SKILL.md';

export type SkillSummary = {
  name: string;
  description: string;
  path: string;
};

export const getSkillsDirs = (cwd = process.cwd()): string[] => [
  join(resolve(cwd),'.agents', 'skills'),
  join(homedir(), '.cursor', 'skills-cursor'),
  join(homedir(), '.claude', 'skills'),
  join(FL0W_HOME, 'skills'),
];

let skillRegistry = new Map<string, SkillSummary>();

const parseFrontmatter = (content: string): Record<string, string> => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = match?.[1];
  if (!body) return {};

  const fields: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
};

const fallbackDescription = (content: string): string => {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const line of withoutFrontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return 'No description provided';
};

const parseSkillFile = async (skillPath: string, dirName: string): Promise<SkillSummary | null> => {
  const file = Bun.file(skillPath);
  if (!(await file.exists())) return null;

  const content = (await file.text()).trim();
  if (!content) return null;

  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name?.trim() || dirName;
  const description = frontmatter.description?.trim() || fallbackDescription(content);

  return { name, description, path: skillPath };
};

export const discoverAgentsMd = async (
  rootDir = process.cwd(),
): Promise<Array<{ name: string, description?: string }>> => {
  const agentsPath = join(rootDir, AGENTS_MD_FILENAME);
  const agentsFile = Bun.file(agentsPath);
  if (!(await agentsFile.exists())) return [];

  const content = (await agentsFile.text()).trim();
  if (!content) return [];

  return [{
    name: AGENTS_MD_FILENAME,
    description: 'Workspace agent instructions loaded at session start',
  }];
};

export const discoverSkills = async (dirs = getSkillsDirs()): Promise<SkillSummary[]> => {
  const byName = new Map<string, SkillSummary>();

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries.sort()) {
      const skillPath = join(dir, entry, SKILL_FILENAME);
      const summary = await parseSkillFile(skillPath, entry);
      if (!summary || byName.has(summary.name)) continue;
      byName.set(summary.name, summary);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const listSkills = (): SkillSummary[] => [...skillRegistry.values()];

export const loadSkillContent = async (name: string): Promise<string | null> => {
  const skill = skillRegistry.get(name);
  if (!skill) return null;

  const content = (await readFile(skill.path, 'utf8')).trim();
  return content || null;
};

const formatSkillsCatalog = (skills: SkillSummary[]): string => {
  const entries = skills
    .map((skill) =>
      `<agent_skill fullPath="${skill.path}">\n${skill.description}\n</agent_skill>`,
    )
    .join('\n\n');

  return [
    '<available_skills>',
    'Skills are special instructions for specific tasks. Only read a skill when it is relevant.',
    'When a skill applies, call the load_skill tool with the skill name before following it.',
    '',
    entries,
    '</available_skills>',
  ].join('\n');
};

export const frontLoadMessages = async (
  rootDir = process.cwd(),
  options?: { skillsDirs?: string[] },
): Promise<ModelMessage[]> => {
  const workspace = resolve(rootDir);
  const messages: ModelMessage[] = [{
    role: 'system',
    content:
      `Workspace root: ${workspace}\n` +
      'For file tools (read, edit, write, list_dir, glob), use paths relative to this directory (e.g. "src/index.ts"). ' +
      'Do not use root-relative paths like "/src/index.ts".',
  }];

  const agentsPath = join(rootDir, AGENTS_MD_FILENAME);
  const agentsFile = Bun.file(agentsPath);
  if (
    await agentsFile.exists()
    && isCapabilityEnabled('agentsMd', AGENTS_MD_FILENAME)
  ) {
    const content = (await agentsFile.text()).trim();
    if (content) {
      messages.push({ role: 'system', content });
    }
  }

  const skills = (await discoverSkills(options?.skillsDirs ?? getSkillsDirs(rootDir)))
    .filter((skill) => isCapabilityEnabled('skills', skill.name));
  skillRegistry = new Map(skills.map((skill) => [skill.name, skill]));
  if (skills.length > 0) {
    messages.push({ role: 'system', content: formatSkillsCatalog(skills) });
  }

  return messages;
};
