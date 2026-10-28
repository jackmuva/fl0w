import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillService } from '../../external-tools/skill-service';
import { executeGlob } from './glob';
import { executeGrep } from './grep';
import { executeListDir } from './list-dir';
import { executeLoadSkill } from './load-skill';
import { executeReadFile } from './read-file';
import { executeWriteFile } from './write-file';

const skillsRoot = join(tmpdir(), `fl0w-skills-${crypto.randomUUID()}`);
const skillDir = join(skillsRoot, 'demo-skill');
const referencePath = join(skillDir, 'references', 'guide.md');

beforeEach(async () => {
  await mkdir(join(skillDir, 'references'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo.\n---\nSee references/guide.md');
  await writeFile(referencePath, 'Reference body');
  skillService.setActiveSkills([{ name: 'demo-skill', description: 'Demo.', path: join(skillDir, 'SKILL.md') }]);
});

afterEach(async () => {
  skillService.setActiveSkills([]);
  await rm(skillsRoot, { recursive: true, force: true });
});

describe('executeLoadSkill', () => {
  test('includes the base directory and bundled files', async () => {
    const output = await executeLoadSkill({ name: 'demo-skill' });
    expect(output).toContain(`Base directory for this skill: ${skillDir}`);
    expect(output).toContain('- references/guide.md');
    expect(output).not.toContain('- SKILL.md');
    expect(output).toContain('See references/guide.md');
  });
});

describe('skill directory access', () => {
  test('read-only tools can access active skill directories', async () => {
    expect(await executeReadFile({ filePath: referencePath })).toContain('Reference body');
    expect(await executeListDir({ path: skillDir })).toContain('references/');
    expect(await executeGlob({ pattern: '*.md', path: skillDir })).toContain(referencePath);
    expect(await executeGrep({ pattern: 'Reference', path: skillDir })).toContain('Reference body');
  });

  test('read-only tools still reject paths outside workspace and skill directories', async () => {
    skillService.setActiveSkills([]);
    await expect(executeReadFile({ filePath: referencePath })).rejects.toThrow('outside the workspace');
  });

  test('write tools cannot modify skill directories', async () => {
    await expect(executeWriteFile({ filePath: referencePath, content: 'x' })).rejects.toThrow('outside the workspace');
  });
});
