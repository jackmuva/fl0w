import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import type { SkillSummary } from '../external-tools/skill-service';

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
  BUNDLE_SYNC_STATE_PATH: join(home, 'bundle-sync-state.json'),
  SYNC_CONFLICTS_DIR: join(home, 'sync-conflicts'),
}));
const { AUTH_PATH, BUNDLE_SYNC_STATE_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home) || !BUNDLE_SYNC_STATE_PATH.startsWith(home)) throw new Error('skill-sync test is not isolated');
const { syncSkillService, packFiles } = await import('./sync-skills');

type ServerSkill = { contentHash: string, size: number, bundle: Uint8Array, updatedAt: string };
let server: Map<string, ServerSkill>;
let requests: string[];
/** Runs once just before fl0w-work handles the next PUT, to simulate another device writing in between. */
let beforeNextPut: (() => Promise<void>) | null;
const realFetch = globalThis.fetch;

const meta = (name: string, skill: ServerSkill) => ({ name, contentHash: skill.contentHash, size: skill.size, updatedAt: skill.updatedAt });

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://fl0w.test' || !url.pathname.startsWith('/api/sync/skills')) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${url.pathname}`);
  const name = url.pathname === '/api/sync/skills' ? null : decodeURIComponent(url.pathname.split('/').pop()!);
  if (!name) return Response.json({ skills: [...server].map(([n, skill]) => meta(n, skill)) });

  const existing = server.get(name);
  if (method === 'GET') {
    if (!existing) return Response.json({ error: 'not_found' }, { status: 404 });
    return new Response(existing.bundle.slice(), { headers: { 'x-skill-content-hash': existing.contentHash } });
  }
  if (method === 'DELETE') {
    server.delete(name);
    return new Response(null, { status: existing ? 204 : 404 });
  }

  if (beforeNextPut) {
    const run = beforeNextPut;
    beforeNextPut = null;
    await run();
  }
  const headers = new Headers(init!.headers);
  const current = server.get(name);
  const base = headers.get('x-base-content-hash');
  if (base !== null && (current?.contentHash ?? 'none') !== base) {
    return Response.json({ error: 'conflict', skill: current ? meta(name, current) : null }, { status: 409 });
  }
  const bundle = (init!.body as Uint8Array).slice();
  const skill = { contentHash: headers.get('x-skill-content-hash')!, size: bundle.byteLength, bundle, updatedAt: new Date().toISOString() };
  server.set(name, skill);
  return Response.json({ skill: meta(name, skill) });
};

/** Stores `files` as fl0w-work's copy of `name`, as if edited on the remote computer at `updatedAt`. */
const remoteEdit = async (name: string, files: Record<string, string>, updatedAt = new Date().toISOString()) => {
  const dir = join(home, 'remote-src', name);
  await rm(dir, { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  const packed = await packFiles(dir, Object.keys(files).sort());
  server.set(name, { contentHash: packed.contentHash, size: packed.bundle.byteLength, bundle: packed.bundle, updatedAt });
};

const remoteFiles = async (name: string) => {
  const files = await new Bun.Archive(server.get(name)!.bundle).files();
  return Object.fromEntries(await Promise.all([...files].map(async ([path, file]) => [path, await file.text()] as const)));
};

const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();

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

beforeEach(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  server = new Map();
  requests = [];
  beforeNextPut = null;
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
    const first = await syncSkillService.packSkill(dir);
    await Bun.sleep(1100); // the tarball embeds second-resolution mtimes; the hash must not
    expect((await syncSkillService.packSkill(dir)).contentHash).toBe(first.contentHash);

    await writeFile(skill.path, 'new steps');
    expect((await syncSkillService.packSkill(dir)).contentHash).not.toBe(first.contentHash);
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
    const packed = await syncSkillService.packSkill(join(skillsDir, 'demo'));
    expect(packed.files).toEqual(['SKILL.md', 'ref/notes.md']);

    const unpacked = await new Bun.Archive(packed.bundle).files();
    expect([...unpacked.keys()].sort()).toEqual(['SKILL.md', 'ref/notes.md']);
    expect(await unpacked.get('ref/notes.md')!.text()).toBe('notes');
  });
});

describe('syncSkills', () => {
  test('does nothing when signed out', async () => {
    const skill = await writeSkill('demo', { 'SKILL.md': 'steps' });
    expect(await syncSkillService.syncSkills([skill])).toBeNull();
    expect(requests).toEqual([]);
  });

  test('uploads every skill once and skips them while unchanged', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    const other = await writeSkill('other', { 'SKILL.md': 'other steps' });

    expect(await syncSkillService.syncSkills([demo, other])).toEqual({ demo: 'pushed', other: 'pushed' });
    expect([...server.keys()].sort()).toEqual(['demo', 'other']);

    requests = [];
    expect(await syncSkillService.syncSkills([demo, other])).toEqual({ demo: 'unchanged', other: 'unchanged' });
    expect(requests).toEqual(['GET /api/sync/skills']);

    await writeFile(demo.path, 'edited steps');
    expect(await syncSkillService.syncSkills([demo, other])).toEqual({ demo: 'pushed', other: 'unchanged' });
  });

  test('reports a skill whose mirror folder is missing without failing the rest', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    const ghost: SkillSummary = { name: 'ghost', description: '', path: join(home, 'elsewhere', 'ghost', 'SKILL.md') };

    const results = await syncSkillService.syncSkills([demo, ghost]);
    expect(results?.demo).toBe('pushed');
    expect(results?.ghost).toBeInstanceOf(Error);
  });
});

describe('syncSkills pull and merge', () => {
  const signIn = () => writeJson('auth.json', { fl0w: fl0wLogin });

  test('pulls a skill that only exists on fl0w-work into ~/.fl0w/skills', async () => {
    await signIn();
    await remoteEdit('remote-only', { 'SKILL.md': 'from the computer', 'ref/notes.md': 'notes' });

    expect(await syncSkillService.syncSkills([])).toEqual({ 'remote-only': 'pulled' });
    expect(await readFile(join(skillsDir, 'remote-only', 'ref', 'notes.md'), 'utf8')).toBe('notes');

    requests = [];
    const pulled = { name: 'remote-only', description: '', path: join(skillsDir, 'remote-only', 'SKILL.md') };
    expect(await syncSkillService.syncSkills([pulled])).toEqual({ 'remote-only': 'unchanged' });
    expect(requests).toEqual(['GET /api/sync/skills']);
  });

  test('pulls edits into the skill\'s own folder outside ~/.fl0w/skills and refreshes its mirror', async () => {
    await signIn();
    const origin = join(home, 'claude-skills', 'demo');
    await mkdir(origin, { recursive: true });
    await writeFile(join(origin, 'SKILL.md'), 'steps');
    const demo: SkillSummary = { name: 'demo', description: '', path: join(origin, 'SKILL.md') };

    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'pushed' });
    await remoteEdit('demo', { 'SKILL.md': 'steps edited on the computer' });

    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'pulled' });
    expect(await readFile(join(origin, 'SKILL.md'), 'utf8')).toBe('steps edited on the computer');
    expect(await readFile(join(skillsDir, 'demo', 'SKILL.md'), 'utf8')).toBe('steps edited on the computer');
  });

  test('keeps both sides\' changes to different files and pushes the merge', async () => {
    await signIn();
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps', 'ref.md': 'ref' });
    await syncSkillService.syncSkills([demo]);

    await writeFile(join(skillsDir, 'demo', 'SKILL.md'), 'steps edited here');
    await remoteEdit('demo', { 'SKILL.md': 'steps', 'ref.md': 'ref edited there', 'new.md': 'new there' });

    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'merged' });
    const expected = { 'SKILL.md': 'steps edited here', 'new.md': 'new there', 'ref.md': 'ref edited there' };
    expect(await remoteFiles('demo')).toEqual(expected);
    for (const [file, content] of Object.entries(expected)) {
      expect(await readFile(join(skillsDir, 'demo', file), 'utf8')).toBe(content);
    }
  });

  test('a file changed on both sides keeps the newer copy and backs up the other', async () => {
    await signIn();
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    await syncSkillService.syncSkills([demo]);

    await writeFile(demo.path, 'older local edit');
    await remoteEdit('demo', { 'SKILL.md': 'newer remote edit' }, future());
    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'pulled' });
    expect(await readFile(demo.path, 'utf8')).toBe('newer remote edit');
    const [stamp] = await readdir(join(home, 'sync-conflicts', 'skills', 'demo'));
    expect(await readFile(join(home, 'sync-conflicts', 'skills', 'demo', stamp!, 'SKILL.md'), 'utf8')).toBe('older local edit');

    await writeFile(demo.path, 'newer local edit');
    await remoteEdit('demo', { 'SKILL.md': 'older remote edit' }, past());
    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'pushed' });
    expect(await remoteFiles('demo')).toEqual({ 'SKILL.md': 'newer local edit' });
  });

  test('a skill deleted on fl0w-work is deleted here, leaving files sync never touches', async () => {
    await signIn();
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps', 'scripts/run.sh': 'echo', '.env': 'TOKEN=x' });
    await syncSkillService.syncSkills([demo]);

    server.delete('demo');
    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'deleted' });
    expect(await readdir(join(skillsDir, 'demo'))).toEqual(['.env']);
    const [stamp] = await readdir(join(home, 'sync-conflicts', 'skills', 'demo'));
    expect(await readFile(join(home, 'sync-conflicts', 'skills', 'demo', stamp!, 'scripts', 'run.sh'), 'utf8')).toBe('echo');

    requests = [];
    expect(await syncSkillService.syncSkills([])).toEqual({});
    expect(requests).toEqual(['GET /api/sync/skills']);
  });

  test('a skill deleted here is deleted on fl0w-work, unless fl0w-work changed it since', async () => {
    await signIn();
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps' });
    const other = await writeSkill('other', { 'SKILL.md': 'other steps' });
    await syncSkillService.syncSkills([demo, other]);

    await rm(join(skillsDir, 'demo'), { recursive: true });
    await rm(join(skillsDir, 'other'), { recursive: true });
    await remoteEdit('other', { 'SKILL.md': 'edited on the computer' });

    expect(await syncSkillService.syncSkills([])).toEqual({ demo: 'deleted', other: 'pulled' });
    expect(server.has('demo')).toBe(false);
    expect(await readFile(other.path, 'utf8')).toBe('edited on the computer');
  });

  test('merges again when fl0w-work changes between the merge and the push', async () => {
    await signIn();
    const demo = await writeSkill('demo', { 'SKILL.md': 'steps', 'a.md': 'a', 'b.md': 'b' });
    await syncSkillService.syncSkills([demo]);

    await writeFile(join(skillsDir, 'demo', 'a.md'), 'a here');
    await remoteEdit('demo', { 'SKILL.md': 'steps', 'a.md': 'a', 'b.md': 'b there' });
    beforeNextPut = () => remoteEdit('demo', { 'SKILL.md': 'steps there', 'a.md': 'a', 'b.md': 'b there' });

    expect(await syncSkillService.syncSkills([demo])).toEqual({ demo: 'merged' });
    expect(await remoteFiles('demo')).toEqual({ 'SKILL.md': 'steps there', 'a.md': 'a here', 'b.md': 'b there' });
    expect(await readFile(demo.path, 'utf8')).toBe('steps there');
  });
});
