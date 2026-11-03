import { afterEach, describe, expect, mock, test } from 'bun:test';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import type { SkillSummary } from '../external-tools/skill-service';

const tempRoot = join(import.meta.dir, '__fixtures__', 'mirror-skills');
const fl0wHome = join(tempRoot, 'fl0w-home');
const externalSkills = join(tempRoot, 'external-skills');
const fl0wSkillsDir = join(fl0wHome, 'skills');

mock.module('../../constants', () => ({
  ...constants,
  FL0W_HOME: fl0wHome,
  FL0W_SKILLS_DIR: fl0wSkillsDir,
  AUTH_PATH: join(fl0wHome, 'auth.json'),
  APP_CONFIG_PATH: join(fl0wHome, 'config.json'),
}));

const { syncSkillService } = await import('./sync-skills');

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

describe('mirrorSkills', () => {
  test('copies external skills into FL0W_HOME/skills', async () => {
    const skillPath = await writeSkill(externalSkills, 'demo-skill', 'demo-skill', 'Steps', {
      'helper.txt': 'extra',
    });
    const catalog: SkillSummary[] = [{
      name: 'demo-skill',
      description: 'demo-skill description',
      path: skillPath,
    }];

    const result = await syncSkillService.mirrorSkills(catalog);

    expect(result).toEqual({
      mirrored: ['demo-skill'],
      skipped: [],
      errors: [],
    });
    expect(await readFile(join(fl0wSkillsDir, 'demo-skill', 'SKILL.md'), 'utf8')).toContain('Steps');
    expect(await readFile(join(fl0wSkillsDir, 'demo-skill', 'helper.txt'), 'utf8')).toBe('extra');
  });

  test('copies the files of a symlinked skill, not the link', async () => {
    await writeSkill(join(tempRoot, 'real'), 'linked-skill', 'linked-skill', 'Linked body', {
      'helper.txt': 'extra',
    });
    await mkdir(externalSkills, { recursive: true });
    await symlink(join(tempRoot, 'real', 'linked-skill'), join(externalSkills, 'linked-skill'));
    const catalog: SkillSummary[] = [{
      name: 'linked-skill',
      description: 'linked-skill description',
      path: join(externalSkills, 'linked-skill', 'SKILL.md'),
    }];

    const result = await syncSkillService.mirrorSkills(catalog);

    expect(result.mirrored).toEqual(['linked-skill']);
    const dest = join(fl0wSkillsDir, 'linked-skill');
    expect((await lstat(dest)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('Linked body');
    expect(await readFile(join(dest, 'helper.txt'), 'utf8')).toBe('extra');
  });

  test('skips a symlinked skill that points into FL0W_HOME/skills without deleting it', async () => {
    await writeSkill(fl0wSkillsDir, 'own-skill', 'own-skill', 'Own body');
    await mkdir(externalSkills, { recursive: true });
    await symlink(join(fl0wSkillsDir, 'own-skill'), join(externalSkills, 'own-skill'));
    const catalog: SkillSummary[] = [{
      name: 'own-skill',
      description: 'own-skill description',
      path: join(externalSkills, 'own-skill', 'SKILL.md'),
    }];

    const result = await syncSkillService.mirrorSkills(catalog);

    expect(result.skipped).toEqual(['own-skill']);
    expect(await readFile(join(fl0wSkillsDir, 'own-skill', 'SKILL.md'), 'utf8')).toContain('Own body');
  });

  test('skips skills already under FL0W_HOME/skills', async () => {
    const skillPath = await writeSkill(fl0wSkillsDir, 'local-skill', 'local-skill', 'Local body');
    const catalog: SkillSummary[] = [{
      name: 'local-skill',
      description: 'local-skill description',
      path: skillPath,
    }];

    const result = await syncSkillService.mirrorSkills(catalog);

    expect(result.skipped).toEqual(['local-skill']);
    expect(result.mirrored).toEqual([]);
  });

  test('overwrites an existing mirror', async () => {
    const skillPath = await writeSkill(externalSkills, 'refresh-skill', 'refresh-skill', 'Version one');
    const catalog: SkillSummary[] = [{
      name: 'refresh-skill',
      description: 'refresh-skill description',
      path: skillPath,
    }];

    await syncSkillService.mirrorSkills(catalog);
    await writeSkill(externalSkills, 'refresh-skill', 'refresh-skill', 'Version two');
    await syncSkillService.mirrorSkills(catalog);

    expect(await readFile(join(fl0wSkillsDir, 'refresh-skill', 'SKILL.md'), 'utf8')).toContain('Version two');
  });

  test('mirrors every skill in the catalog', async () => {
    const catalog: SkillSummary[] = await Promise.all(['one-skill', 'two-skill'].map(async (name) => ({
      name,
      description: `${name} description`,
      path: await writeSkill(externalSkills, name, name, `${name} body`),
    })));

    const result = await syncSkillService.mirrorSkills(catalog);

    expect(result.mirrored.sort()).toEqual(['one-skill', 'two-skill']);
  });
});
