import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FL0W_HOME } from '../../../constants';
import { setCapabilitySelection } from '../config';
import type { WorkflowRecord } from '../../../models/workflow';
import { activeWorkflowStore } from '../../../store/active-workflow-store';
import {
  AGENTS_MD_FILENAME,
  discoverAgentsMd,
  discoverSkills,
  frontLoadMessages,
  getSkillsDirs,
  listSkills,
  loadSkillContent,
} from './front-load';

const tempRoot = join(import.meta.dir, '__fixtures__', 'skills-front-load');

afterEach(async () => {
  activeWorkflowStore.clear();
  await rm(tempRoot, { recursive: true, force: true });
});

describe('frontLoadMessages skills', () => {
  test('front-loads skill catalog without full skill bodies', async () => {
    const skillsDir = join(tempRoot, 'skills', 'demo-skill');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, 'SKILL.md'),
      [
        '---',
        'name: demo-skill',
        'description: Use for demo tasks.',
        '---',
        '# Demo Skill',
        'Follow these detailed steps.',
      ].join('\n'),
    );

    setCapabilitySelection({ skills: ['demo-skill'], mcpServers: [], userTools: [], agentsMd: [] });
    const messages = await frontLoadMessages(tempRoot, { skillsDirs: [join(tempRoot, 'skills')] });
    const catalog = messages.find(
      (message) => message.role === 'system' && String(message.content).includes('<available_skills>'),
    );

    expect(catalog).toBeDefined();
    expect(String(catalog?.content)).toContain('Use for demo tasks.');
    expect(String(catalog?.content)).not.toContain('Follow these detailed steps.');

    const content = await loadSkillContent('demo-skill');
    expect(content).toContain('Follow these detailed steps.');
  });

  test('getSkillsDirs includes the workspace skills directory first', () => {
    expect(getSkillsDirs(tempRoot)[0]).toBe(join(tempRoot, '.agents', 'skills'));
  });

  test('getSkillsDirs lists FL0W_HOME/skills last', () => {
    const dirs = getSkillsDirs(tempRoot);
    expect(dirs[dirs.length - 1]).toBe(join(FL0W_HOME, 'skills'));
  });

  test('prefers workspace skill paths over FL0W_HOME/skills for the same name', async () => {
    for (const root of [join(tempRoot, 'fl0w-skills'), join(tempRoot, 'skills')]) {
      const dir = join(root, 'shared-skill');
      await mkdir(dir, { recursive: true });
      const body = root.endsWith('fl0w-skills') ? 'From fl0w home.' : 'From workspace.';
      await writeFile(
        join(dir, 'SKILL.md'),
        `---\nname: shared-skill\ndescription: ${body}\n---\n${body}`,
      );
    }

    const skills = await discoverSkills([join(tempRoot, 'skills'), join(tempRoot, 'fl0w-skills')]);
    expect(skills).toEqual([{
      name: 'shared-skill',
      description: 'From workspace.',
      path: join(tempRoot, 'skills', 'shared-skill', 'SKILL.md'),
    }]);
  });

  test('frontLoadMessages discovers workspace skills without a custom skillsDirs override', async () => {
    const skillsDir = join(tempRoot, '.agents', 'skills', 'workspace-skill');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, 'SKILL.md'),
      '---\nname: workspace-skill\ndescription: Workspace-local skill.\n---\nBody',
    );

    setCapabilitySelection({ skills: ['workspace-skill'], mcpServers: [], userTools: [], agentsMd: [] });
    const messages = await frontLoadMessages(tempRoot, { skillsDirs: getSkillsDirs(tempRoot) });
    const catalog = messages.map((message) => String(message.content)).join('\n');

    expect(catalog).toContain('Workspace-local skill.');
    expect(await loadSkillContent('workspace-skill')).toContain('Body');
  });

  test('discovers skills from a custom directory', async () => {
    const skillsDir = join(tempRoot, 'custom', 'lint-helper');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, 'SKILL.md'),
      '# Lint Helper\nRun lint before committing.',
    );

    const skills = await discoverSkills([join(tempRoot, 'custom')]);
    expect(skills).toEqual([{
      name: 'lint-helper',
      description: 'Run lint before committing.',
      path: join(skillsDir, 'SKILL.md'),
    }]);
  });

  test('only front-loads enabled skills', async () => {
    for (const name of ['kept-skill', 'dropped-skill']) {
      const dir = join(tempRoot, 'skills', name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\nBody`);
    }

    setCapabilitySelection({
      skills: ['kept-skill'],
      mcpServers: [],
      userTools: [],
      agentsMd: [],
    });
    const messages = await frontLoadMessages(tempRoot, { skillsDirs: [join(tempRoot, 'skills')] });
    const catalog = messages.map((message) => String(message.content)).join('\n');

    expect(catalog).toContain('kept-skill description');
    expect(catalog).not.toContain('dropped-skill description');
    expect(listSkills().map((skill) => skill.name)).toEqual(['kept-skill']);
    expect(await loadSkillContent('dropped-skill')).toBeNull();
  });
});

describe('frontLoadMessages agents md', () => {
  test('discovers AGENTS.md when present', async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, AGENTS_MD_FILENAME), '# Agent guide\nFollow repo conventions.');

    await expect(discoverAgentsMd(tempRoot)).resolves.toEqual([{
      name: AGENTS_MD_FILENAME,
      description: 'Workspace agent instructions loaded at session start',
    }]);
  });

  test('only front-loads AGENTS.md when enabled', async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, AGENTS_MD_FILENAME), 'Always load these instructions.');

    setCapabilitySelection({
      skills: [],
      mcpServers: [],
      userTools: [],
      agentsMd: [],
    });
    const disabled = await frontLoadMessages(tempRoot);
    expect(disabled.map((message) => String(message.content)).join('\n')).not.toContain('Always load these instructions.');

    setCapabilitySelection({
      skills: [],
      mcpServers: [],
      userTools: [],
      agentsMd: [AGENTS_MD_FILENAME],
    });
    const enabled = await frontLoadMessages(tempRoot);
    expect(enabled.map((message) => String(message.content)).join('\n')).toContain('Always load these instructions.');
  });
});

describe('frontLoadMessages active workflow', () => {
  const workflow: WorkflowRecord = {
    id: 'wf-1',
    sourceSessionId: null,
    title: 'Open PR',
    goal: 'Open a PR for the change',
    requiredCapabilities: { skills: [], mcpServers: [], userTools: [], agentsMd: [] },
    models: null,
    createdAt: '1970-01-01T00:00:00.001Z',
    updatedAt: '1970-01-01T00:00:00.001Z',
    steps: [
      {
        index: 1,
        description: 'Find the handler',
        instructions: 'Search the source tree for the handler',
        tools: [{ tool: 'default/grep', parameters: { pattern: '{{handler}}' } }],
      },
      { index: 2, description: 'Open the PR', instructions: 'Push and open a PR' },
    ],
  };

  const workflowMessage = async () =>
    (await frontLoadMessages(tempRoot, { skillsDirs: [] }))
      .find((message) => String(message.content).includes('<workflow'));

  test('front-loads the plan, step tools, and user instructions', async () => {
    activeWorkflowStore.set(workflow, 'handler is loginHandler');
    const content = String((await workflowMessage())?.content);

    expect(content).toContain('Goal: Open a PR for the change');
    expect(content).toContain('### Step 1: Find the handler');
    expect(content).toContain('- default/grep({"pattern":"{{handler}}"})');
    expect(content).toContain('### Step 2: Open the PR');
    expect(content).toContain('default/mark_step_complete');
    expect(content).toContain('handler is loginHandler');
  });

  test('omits the workflow once cleared', async () => {
    activeWorkflowStore.set(workflow);
    activeWorkflowStore.clear();
    expect(await workflowMessage()).toBeUndefined();
  });
});
