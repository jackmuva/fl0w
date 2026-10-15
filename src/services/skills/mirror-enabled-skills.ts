import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FL0W_SKILLS_DIR } from '../../constants';
import type { CapabilitySelection } from '../../models/agent';
import type { SkillSummary } from '../agent/hooks/front-load';

export type MirrorEnabledSkillsResult = {
  mirrored: string[];
  skipped: string[];
  missing: string[];
  errors: Array<{ name: string; error: string }>;
};

const isUnderFl0wSkills = (skillDir: string): boolean => {
  const base = resolve(FL0W_SKILLS_DIR);
  const target = resolve(skillDir);
  return target === base || target.startsWith(`${base}/`);
};

/** Copies enabled skills into ~/.fl0w/skills for portability and future sync. Runtime still reads source paths. */
export async function mirrorEnabledSkills(
  selection: CapabilitySelection,
  catalog: SkillSummary[],
): Promise<MirrorEnabledSkillsResult> {
  const byName = new Map(catalog.map((skill) => [skill.name, skill]));
  const result: MirrorEnabledSkillsResult = {
    mirrored: [],
    skipped: [],
    missing: [],
    errors: [],
  };

  if (selection.skills.length === 0) return result;

  await mkdir(FL0W_SKILLS_DIR, { recursive: true });

  for (const name of selection.skills) {
    const skill = byName.get(name);
    if (!skill) {
      result.missing.push(name);
      continue;
    }

    const skillDir = dirname(resolve(skill.path));
    if (isUnderFl0wSkills(skillDir)) {
      result.skipped.push(name);
      continue;
    }

    const dest = join(FL0W_SKILLS_DIR, basename(skillDir));

    try {
      await rm(dest, { recursive: true, force: true });
      await cp(skillDir, dest, { recursive: true, force: true });
      result.mirrored.push(name);
    } catch (error) {
      result.errors.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
