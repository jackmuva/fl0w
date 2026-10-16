import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import type { SkillSummary } from '../agent/hooks/front-load';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'skill-sync');
const skillsDir = join(home, 'skills');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  FL0W_HOME: home,
  FL0W_SKILLS_DIR: skillsDir,
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
}));
const { AUTH_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home)) throw new Error('skill-sync test is not isolated');
const { packSkill, syncEnabledSkills } = await import('./sync-skills');

let server: Map<string, { contentHash: string, size: number, bundle: Uint8Array }>;
let requests: string[];
const realFetch = globalThis.fetch;

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://fl0w.test' || !url.pathname.startsWith('/api/sync/skills')) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${url.pathname}`);
  if (method === 'GET') {
    return Response.json({ skills: [...server].map(([name, s]) => ({ name, contentHash: s.contentHash, size: s.size, updatedAt: 'now' })) });
  }
  const name = decodeURIComponent(url.pathname.split('/').pop()!);
  const headers = new Headers(init!.headers);
  const bundle = init!.body as Uint8Array;
  const skill = { contentHash: headers.get('x-skill-content-hash')!, size: bundle.byteLength, bundle };
  server.set(name, skill);
  return Response.json({ skill: { name, contentHash: skill.contentHash, size: skill.size, updatedAt: 'now' } });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const writeJson = (name: string, value: unknown) => writeFile(join(home, name), JSON.stringify(value));

const writeSkill = async (folder: string, files: Record<string, string>): Promise<SkillSummary> => {
  const dir = join(skillsDir, folder);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  return { name: folder, description: `${folder} description`, path: join(dir, 'SKILL.md') };
};

const selection = (...skills: string[]) => ({ skills, mcpServers: [], userTools: [], agentsMd: [] });

beforeEach(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  server = new Map();
  requests = [];
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(home, { recursive: true, force: true });
});

describe('packSkill', () => {
  test('content hash is stable across runs and changes with content', async () => {
    const skill = await writeSkill('demo', { 'SKILL.md': 'steps', 'scripts/run.sh': 'echo hi' });
    const dir = join(skillsDir, 'demo');
    const first = await packSkill(dir);
    await Bun.sleep(1100); // the tarball embeds second-resolution mtimes; the hash must not
    expect((await packSkill(dir)).contentHash).toBe(first.contentHash);

    await writeFile(skill.path, 'new steps');
    expect((await packSkill(dir)).contentHash).not.toBe(first.contentHash);
  });

  test('excludes secrets, node_modules, and .git, and round-trips the rest', async () => {
    await writeSkill('demo', {
      'SKILL.md': 'steps',
      'ref/notes.md': 'notes',
      '.env': 'TOKEN=x',
      '.env.local': 'TOKEN=y',
      'cert.pem': 'pem',
      'node_modules/dep/index.js': 'x',
      '.git/HEAD': 'ref',
    });
    const packed = await packSkill(join(skillsDir, 'demo'));
    expect(packed.files).toEqual(['SKILL.md', 'ref/notes.md']);

    const unpacked = await new Bun.Archive(packed.bundle).files();
    expect([...unpacked.keys()].sort()).toEqual(['SKILL.md', 'ref/notes.md']);
    expect(await unpacked.get('ref/notes.md')!.text()).toBe('notes');
  });
});

describe('syncEnabledSkills', () => {
  test('does nothing when signed out or sync is disabled', async () => {
    const skill = await writeSkill('demo', { 'SKILL.md': 'steps' });
    expect(await syncEnabledSkills(selection('demo'), [skill])).toBeNull();
    await writeJson('auth.json', { fl0w: fl0wLogin });
    await writeJson('config.json', { sync: false });
    expect(await syncEnabledSkills(selection('demo'), [skill])).toBeNull();
    expect(requests).toEqual([]);
  });

  test('uploads enabled skills once and skips them while unchanged', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    const other = await writeSkill('other', { 'SKILL.md': 'other steps' });

    expect(await syncEnabledSkills(selection('demo'), [demo, other])).toEqual({ demo: 'pushed' });
    expect([...server.keys()]).toEqual(['demo']);

    requests = [];
    expect(await syncEnabledSkills(selection('demo'), [demo, other])).toEqual({ demo: 'unchanged' });
    expect(requests).toEqual(['GET /api/sync/skills']);

    await writeFile(demo.path, 'edited steps');
    expect(await syncEnabledSkills(selection('demo'), [demo, other])).toEqual({ demo: 'pushed' });
  });

  test('reports a skill whose mirror folder is missing without failing the rest', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    const ghost: SkillSummary = { name: 'ghost', description: '', path: join(home, 'elsewhere', 'ghost', 'SKILL.md') };

    const results = await syncEnabledSkills(selection('ghost', 'demo'), [demo, ghost]);
    expect(results?.demo).toBe('pushed');
    expect(results?.ghost).toBeInstanceOf(Error);
  });
});
