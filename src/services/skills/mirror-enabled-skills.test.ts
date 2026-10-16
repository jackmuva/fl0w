import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import { emptyCapabilitySelection } from '../agent/capabilities';
import type { SkillSummary } from '../agent/hooks/front-load';

const tempRoot = join(import.meta.dir, '__fixtures__', 'mirror-skills');
const fl0wHome = join(tempRoot, 'fl0w-home');
const externalSkills = join(tempRoot, 'external-skills');
const fl0wSkillsDir = join(fl0wHome, 'skills');

mock.module('../../constants', () => ({
  ...constants,
  FL0W_HOME: fl0wHome,
  FL0W_SKILLS_DIR: fl0wSkillsDir,
  // signed out here, so the post-mirror skill sync never reaches the network
  AUTH_PATH: join(fl0wHome, 'auth.json'),
  APP_CONFIG_PATH: join(fl0wHome, 'config.json'),
}));

const {
  flushPendingSkillMirrors,
  mirrorEnabledSkills,
  scheduleMirrorEnabledSkills,
} = await import('./mirror-enabled-skills');

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const writeSkill = async (
  root: string,
  folder: string,
  name: string,
  body: string,
  extra?: Record<string, string>,
) => {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`,
  );
  if (extra) {
    for (const [file, content] of Object.entries(extra)) {
      await writeFile(join(dir, file), content);
    }
  }
  return join(dir, 'SKILL.md');
};

describe('mirrorEnabledSkills', () => {
  test('copies enabled external skills into FL0W_HOME/skills', async () => {
    const skillPath = await writeSkill(externalSkills, 'demo-skill', 'demo-skill', 'Steps', {
      'helper.txt': 'extra',
    });
    const catalog: SkillSummary[] = [{
      name: 'demo-skill',
      description: 'demo-skill description',
      path: skillPath,
    }];

    const result = await mirrorEnabledSkills({
      ...emptyCapabilitySelection(),
      skills: ['demo-skill'],
    }, catalog);

    expect(result).toEqual({
      mirrored: ['demo-skill'],
      skipped: [],
      missing: [],
      errors: [],
    });
    expect(await readFile(join(fl0wSkillsDir, 'demo-skill', 'SKILL.md'), 'utf8')).toContain('Steps');
    expect(await readFile(join(fl0wSkillsDir, 'demo-skill', 'helper.txt'), 'utf8')).toBe('extra');
  });

  test('skips skills already under FL0W_HOME/skills', async () => {
    const skillPath = await writeSkill(fl0wSkillsDir, 'local-skill', 'local-skill', 'Local body');
    const catalog: SkillSummary[] = [{
      name: 'local-skill',
      description: 'local-skill description',
      path: skillPath,
    }];

    const result = await mirrorEnabledSkills({
      ...emptyCapabilitySelection(),
      skills: ['local-skill'],
    }, catalog);

    expect(result.skipped).toEqual(['local-skill']);
    expect(result.mirrored).toEqual([]);
  });

  test('overwrites an existing mirror on re-enable', async () => {
    const skillPath = await writeSkill(externalSkills, 'refresh-skill', 'refresh-skill', 'Version one');
    const catalog: SkillSummary[] = [{
      name: 'refresh-skill',
      description: 'refresh-skill description',
      path: skillPath,
    }];
    const selection = { ...emptyCapabilitySelection(), skills: ['refresh-skill'] as string[] };

    await mirrorEnabledSkills(selection, catalog);
    await writeSkill(externalSkills, 'refresh-skill', 'refresh-skill', 'Version two');
    await mirrorEnabledSkills(selection, catalog);

    expect(await readFile(join(fl0wSkillsDir, 'refresh-skill', 'SKILL.md'), 'utf8')).toContain('Version two');
  });

  test('records missing enabled skill names', async () => {
    const result = await mirrorEnabledSkills({
      ...emptyCapabilitySelection(),
      skills: ['ghost-skill'],
    }, []);

    expect(result.missing).toEqual(['ghost-skill']);
  });

  test('scheduleMirrorEnabledSkills debounces until flush', async () => {
    const skillPath = await writeSkill(externalSkills, 'debounced-skill', 'debounced-skill', 'Debounced');
    const catalog: SkillSummary[] = [{
      name: 'debounced-skill',
      description: 'debounced-skill description',
      path: skillPath,
    }];
    const selection = { ...emptyCapabilitySelection(), skills: ['debounced-skill'] as string[] };

    scheduleMirrorEnabledSkills(selection, catalog);
    await expect(readFile(join(fl0wSkillsDir, 'debounced-skill', 'SKILL.md'), 'utf8')).rejects.toThrow();
    await flushPendingSkillMirrors();
    expect(await readFile(join(fl0wSkillsDir, 'debounced-skill', 'SKILL.md'), 'utf8')).toContain('Debounced');
  });

  test('does not remove mirrored skills when disabled', async () => {
    const skillPath = await writeSkill(externalSkills, 'keep-skill', 'keep-skill', 'Keep me');
    const catalog: SkillSummary[] = [{
      name: 'keep-skill',
      description: 'keep-skill description',
      path: skillPath,
    }];

    await mirrorEnabledSkills({ ...emptyCapabilitySelection(), skills: ['keep-skill'] }, catalog);
    await mirrorEnabledSkills(emptyCapabilitySelection(), catalog);

    expect(await readFile(join(fl0wSkillsDir, 'keep-skill', 'SKILL.md'), 'utf8')).toContain('Keep me');
  });
});
