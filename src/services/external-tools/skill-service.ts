import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FL0W_HOME } from '../../constants';

export const SKILL_FILENAME = 'SKILL.md';

const MAX_SKILL_FILES_LISTED = 50;

/** YAML block scalar indicators: >, >-, >+, |, |-, possibly with an indentation digit. */
const BLOCK_SCALAR_PATTERN = /^[|>][+-]?\d*$/;

export type SkillSummary = {
  name: string;
  description: string;
  path: string;
};

class SkillService {
  private registry = new Map<string, SkillSummary>();

  getSkillsDirs(cwd = process.cwd()): string[] {
    return [
      join(resolve(cwd), '.agents', 'skills'),
      join(homedir(), '.cursor', 'skills-cursor'),
      join(homedir(), '.claude', 'skills'),
      join(homedir(), '.agents', 'skills'),
      join(FL0W_HOME, 'skills'),
    ];
  }

  listSkills(): SkillSummary[] {
    return [...this.registry.values()];
  }

  setActiveSkills(skills: SkillSummary[]): void {
    this.registry = new Map(skills.map((skill) => [skill.name, skill]));
  }

  async loadSkillContent(name: string): Promise<string | null> {
    const skill = this.registry.get(name);
    if (!skill) return null;

    const content = (await readFile(skill.path, 'utf8')).trim();
    return content || null;
  }

  getSkillBaseDir(name: string): string | null {
    const skill = this.registry.get(name);
    return skill ? dirname(skill.path) : null;
  }

  getActiveSkillDirs(): string[] {
    return this.listSkills().map((skill) => dirname(skill.path));
  }

  async listSkillFiles(name: string): Promise<string[]> {
    const skill = this.registry.get(name);
    if (!skill) return [];

    const glob = new Bun.Glob('**/*');
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: dirname(skill.path), onlyFiles: true })) {
      if (file === SKILL_FILENAME) continue;
      files.push(file);
      if (files.length >= MAX_SKILL_FILES_LISTED) break;
    }
    return files.sort();
  }

  async discoverSkills(dirs = this.getSkillsDirs(), fl0wOnly = false): Promise<SkillSummary[]> {
    const byName = new Map<string, SkillSummary>();

    for (const dir of dirs) {
      if (fl0wOnly && dir !== join(FL0W_HOME, 'skills')) continue;

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }

      for (const entry of entries.sort()) {
        const skillPath = join(dir, entry, SKILL_FILENAME);
        const summary = await this.parseSkillFile(skillPath, entry);
        if (!summary || byName.has(summary.name)) continue;
        byName.set(summary.name, summary);
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const body = match?.[1];
    if (!body) return {};

    const fields: Record<string, string> = {};
    const lines = body.split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line === undefined) break;
      const separator = line.indexOf(':');
      if (separator === -1 || /^[ \t]/.test(line)) {
        index++;
        continue;
      }
      const key = line.slice(0, separator).trim();
      const raw = line.slice(separator + 1).trim();
      if (!BLOCK_SCALAR_PATTERN.test(raw)) {
        if (key) fields[key] = raw;
        index++;
        continue;
      }
      const collected: string[] = [];
      for (let end = index; ; end++) {
        const next = lines[end + 1];
        if (next === undefined || (!next.startsWith(' ') && next.trim() !== '')) break;
        collected.push(next);
      }
      fields[key] = raw.startsWith('>')
        ? collected.map((line) => line.trim()).filter((line) => line !== '').join(' ')
        : collected.map((line) => line.trim()).join('\n').replace(/\n{2,}/g, '\n\n').trim();
      index = index + collected.length + 1;
    }
    return fields;
  }

  private fallbackDescription(content: string): string {
    const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    for (const line of withoutFrontmatter.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      return trimmed;
    }
    return 'No description provided';
  }

  private async parseSkillFile(skillPath: string, dirName: string): Promise<SkillSummary | null> {
    const file = Bun.file(skillPath);
    if (!(await file.exists())) return null;

    const content = (await file.text()).trim();
    if (!content) return null;

    const frontmatter = this.parseFrontmatter(content);
    const name = frontmatter.name?.trim() || dirName;
    const description = frontmatter.description?.trim() || this.fallbackDescription(content);

    return { name, description, path: skillPath };
  }
}

export const skillService = new SkillService();
