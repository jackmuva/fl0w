import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'config-sync');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  APP_CONFIG_PATH: join(home, 'config.json'),
  MCP_CONFIG_PATH: join(home, 'mcp.json'),
  AUTH_PATH: join(home, 'auth.json'),
  SYNC_STATE_PATH: join(home, 'sync-state.json'),
}));
const { AUTH_PATH, SYNC_STATE_PATH } = await import('../../constants');
// these tests write config files; never let them reach the real ~/.fl0w
if (!AUTH_PATH.startsWith(home) || !SYNC_STATE_PATH.startsWith(home)) throw new Error('config-sync test is not isolated');
const { flushPendingPushes, syncConfigFiles, syncOnStartup, watchLocalConfigWrites } = await import('./config-sync');
const { saveFl0wGatewayKey } = await import('../config/app-config');

type Row = { version: number, updatedAt: string, content: unknown };
let server: Map<string, Row>;
let requests: string[];
let conflictOnce: string | null;
const realFetch = globalThis.fetch;

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://fl0w.test' || !url.pathname.startsWith('/api/sync/config-files')) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${url.pathname}`);
  const filename = decodeURIComponent(url.pathname.split('/config-files/')[1] ?? '');
  if (!filename) {
    return Response.json({ files: [...server].map(([f, r]) => ({ filename: f, version: r.version, updatedAt: r.updatedAt })) });
  }
  const row = server.get(filename);
  if (method === 'GET') {
    return row ? Response.json({ filename, version: row.version, updatedAt: row.updatedAt, content: row.content }) : Response.json({}, { status: 404 });
  }
  const { content, baseVersion } = JSON.parse(String(init!.body)) as { content: unknown, baseVersion: number };
  if (conflictOnce === filename) {
    conflictOnce = null;
    server.set(filename, { version: (row?.version ?? 0) + 1, updatedAt: new Date().toISOString(), content: { ...(row?.content as object), llmModel: 'raced' } });
    return Response.json({ error: 'conflict' }, { status: 409 });
  }
  if ((row?.version ?? 0) !== baseVersion) return Response.json({ error: 'conflict' }, { status: 409 });
  const next = { version: baseVersion + 1, updatedAt: new Date().toISOString(), content };
  server.set(filename, next);
  return Response.json({ configFile: { filename, version: next.version, updatedAt: next.updatedAt } });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const write = (name: string, value: unknown) => writeFile(join(home, name), JSON.stringify(value));
const read = async (name: string) => JSON.parse(await Bun.file(join(home, name)).text());
const backdate = async (name: string) => {
  const old = new Date(Date.now() - 60_000);
  await utimes(join(home, name), old, old);
};

beforeEach(async () => {
  await mkdir(home, { recursive: true });
  await write('auth.json', { fl0w: fl0wLogin });
  await write('config.json', { llmModel: 'local' });
  await write('mcp.json', { mcpServers: {} });
  server = new Map();
  requests = [];
  conflictOnce = null;
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(home, { recursive: true, force: true });
});

describe('syncConfigFiles', () => {
  test('skips when not signed in', async () => {
    await write('auth.json', {});
    expect(await syncConfigFiles()).toBeNull();
    expect(requests).toEqual([]);
  });

  test('local mode: a bring-your-own key with no login never calls fl0w-work', async () => {
    await write('auth.json', {});
    await write('config.json', { aiGatewayApiKey: 'own-key' });
    const previousKey = process.env.AI_GATEWAY_API_KEY;
    const stopWatching = watchLocalConfigWrites();
    try {
      expect(await syncOnStartup()).toBeNull();
      // a local config write schedules a push, which must no-op without a login
      expect(await saveFl0wGatewayKey('own-key', join(home, 'config.json'))).toBe(true);
      await flushPendingPushes();
      expect(requests).toEqual([]);
      expect(await Bun.file(join(home, 'sync-state.json')).exists()).toBe(false);
    } finally {
      stopWatching();
      if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = previousKey;
    }
  });

  test('first sign-in with nothing on the server just inserts every file', async () => {
    const results = await syncConfigFiles();
    expect(Object.values(results ?? {}).some((r) => r instanceof Error)).toBe(false);
    expect(requests.filter((r) => r.startsWith('PUT'))).toHaveLength(3);
    expect([...server.values()].map((r) => r.version)).toEqual([1, 1, 1]);
    expect(await syncOnStartup()).toBeNull();
  });

  test('"sync": false in config.json turns sync off without any requests', async () => {
    await write('config.json', { llmModel: 'local', sync: false });
    expect(await syncConfigFiles()).toBeNull();
    expect(await syncOnStartup()).toBeNull();
    expect(requests).toEqual([]);
  });

  test('the sync setting stays on this device', async () => {
    await write('config.json', { llmModel: 'local', sync: true });
    await syncConfigFiles();
    expect(server.get('config.json')?.content).toEqual({ llmModel: 'local' });

    // a remote copy carrying sync: false (e.g. from an older client) never turns this device off
    server.set('config.json', { version: 2, updatedAt: new Date().toISOString(), content: { llmModel: 'web', sync: false } });
    expect((await syncConfigFiles())?.['config.json']).toBe('pulled');
    expect(await read('config.json')).toEqual({ llmModel: 'web', sync: true });
  });

  test('first sync pushes local files that the server lacks', async () => {
    expect(await syncConfigFiles()).toEqual({ 'config.json': 'pushed', 'mcp.json': 'pushed', 'auth.json': 'pushed' });
    expect(server.get('config.json')?.content).toEqual({ llmModel: 'local' });
    expect(server.get('auth.json')?.content).toEqual({ fl0w: fl0wLogin });
    expect((await stat(join(home, 'sync-state.json'))).mode & 0o777).toBe(0o600);
  });

  test('first sync on a new device lets the server win conflicts and keeps local-only keys', async () => {
    server.set('config.json', { version: 3, updatedAt: new Date(0).toISOString(), content: { llmModel: 'remote', aiGatewayApiKey: 'k' } });
    server.set('auth.json', { version: 1, updatedAt: new Date(0).toISOString(), content: { mcp: { linear: { tokens: { access_token: 't' } } } } });

    const results = await syncConfigFiles();
    expect(results?.['config.json']).toBe('pulled');
    expect(await read('config.json')).toEqual({ llmModel: 'remote', aiGatewayApiKey: 'k' });
    // auth.json gains the remote MCP tokens and keeps (and pushes) this device's login
    expect(results?.['auth.json']).toBe('merged');
    expect(await read('auth.json')).toEqual({ fl0w: fl0wLogin, mcp: { linear: { tokens: { access_token: 't' } } } });
    expect(server.get('auth.json')?.version).toBe(2);
  });

  test('later syncs only download changed files and push local edits', async () => {
    await syncConfigFiles();
    requests = [];

    await write('mcp.json', { mcpServers: { demo: { url: 'https://demo' } } });
    expect(await syncConfigFiles()).toEqual({ 'config.json': 'unchanged', 'mcp.json': 'pushed', 'auth.json': 'unchanged' });
    expect(requests.filter((r) => r.startsWith('GET /api/sync/config-files/'))).toEqual([]);
    expect(server.get('mcp.json')).toMatchObject({ version: 2, content: { mcpServers: { demo: { url: 'https://demo' } } } });
  });

  test('pulls a remote change when the local file is untouched', async () => {
    await syncConfigFiles();
    server.set('config.json', { version: 2, updatedAt: new Date().toISOString(), content: { llmModel: 'from-web' } });

    expect((await syncConfigFiles())?.['config.json']).toBe('pulled');
    expect(await read('config.json')).toEqual({ llmModel: 'from-web' });
  });

  test('retries once against the latest version when another device pushes first', async () => {
    await write('config.json', { llmModel: 'base', aiGatewayApiKey: 'k' });
    await syncConfigFiles();
    await write('config.json', { llmModel: 'base', aiGatewayApiKey: 'k-local' });
    await backdate('config.json');
    conflictOnce = 'config.json';

    expect((await syncConfigFiles())?.['config.json']).toBe('pulled');
    const expected = { llmModel: 'raced', aiGatewayApiKey: 'k' };
    expect(await read('config.json')).toEqual(expected);
    expect(server.get('config.json')?.content).toEqual(expected);
  });

  test('syncs when sync-state base or remote content is null', async () => {
    await write('config.json', { llmModel: 'local', decisionModel: 'd-local' });
    await syncConfigFiles();
    await write('sync-state.json', {
      userId: 'u1',
      files: { 'config.json': { version: 1, updatedAt: new Date().toISOString(), base: null } },
    });

    expect((await syncConfigFiles())?.['config.json']).not.toBeInstanceOf(Error);
    expect(await read('config.json')).toEqual({ llmModel: 'local', decisionModel: 'd-local' });
  });

  test('leaves an invalid local file alone and reports it', async () => {
    await writeFile(join(home, 'mcp.json'), '{ not json');
    const results = await syncConfigFiles();
    expect(results?.['mcp.json']).toBeInstanceOf(Error);
    expect(await Bun.file(join(home, 'mcp.json')).text()).toBe('{ not json');
    expect(results?.['config.json']).toBe('pushed');
  });
});
