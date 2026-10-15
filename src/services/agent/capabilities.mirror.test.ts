import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';

const tempRoot = join(import.meta.dir, '__fixtures__', 'capabilities-mirror');
const fl0wHome = join(tempRoot, 'fl0w-home');
const workspace = join(tempRoot, 'workspace');
const fl0wSkillsDir = join(fl0wHome, 'skills');

mock.module('../../constants', () => ({
  ...constants,
  FL0W_HOME: fl0wHome,
  FL0W_SKILLS_DIR: fl0wSkillsDir,
}));

const { applyCapabilitySelection } = await import('./capabilities');

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('applyCapabilitySelection', () => {
  test('mirrors enabled skills before front-loading the catalog', async () => {
    const skillDir = join(workspace, 'skills', 'workspace-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: workspace-skill\ndescription: From workspace.\n---\nBody',
    );

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      await applyCapabilitySelection({
        skills: ['workspace-skill'],
        mcpServers: [],
        userTools: [],
        agentsMd: [],
      });

      expect(await readFile(join(fl0wSkillsDir, 'workspace-skill', 'SKILL.md'), 'utf8')).toContain('Body');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
