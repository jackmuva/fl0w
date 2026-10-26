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
const { APP_CONFIG_PATH, AUTH_PATH, MCP_CONFIG_PATH, SYNC_STATE_PATH } = await import('../../constants');
// these tests write config files; never let them reach the real ~/.fl0w
if (![APP_CONFIG_PATH, AUTH_PATH, MCP_CONFIG_PATH, SYNC_STATE_PATH].every((p) => p.startsWith(home))) throw new Error('config-sync test is not isolated');
const { configSyncStore } = await import('./config-sync');

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
    server.set(filename, { version: (row?.version ?? 0) + 1, updatedAt: new Date().toISOString(), content: { ...(row?.content as object), mcpServers: { raced: { url: 'raced' } } } });
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
    expect(await configSyncStore.syncConfigFiles()).toBeNull();
    expect(requests).toEqual([]);
  });

  test('signed out: local config writes never call fl0w-work', async () => {
    await write('auth.json', {});
    await write('config.json', { llmModel: 'local' });
    const stopWatching = configSyncStore.watchLocalConfigWrites();
    try {
      expect(await configSyncStore.syncOnStartup()).toBeNull();
      // config.json is local-only; only mcp.json and auth.json sync
      await write('config.json', { llmModel: 'local-2' });
      configSyncStore.notifyLocalWrite(join(home, 'config.json'));
      await configSyncStore.flushPendingPushes();
      expect(requests).toEqual([]);
      expect(await Bun.file(join(home, 'sync-state.json')).exists()).toBe(false);
    } finally {
      stopWatching();
    }
  });

  test('first sign-in with nothing on the server just inserts every synced file', async () => {
    const results = await configSyncStore.syncConfigFiles();
    expect(Object.values(results ?? {}).some((r) => r instanceof Error)).toBe(false);
    expect(requests.filter((r) => r.startsWith('PUT'))).toHaveLength(2);
    expect([...server.values()].map((r) => r.version)).toEqual([1, 1]);
    expect(await configSyncStore.syncOnStartup()).toBeNull();
  });

  test('local config.json stays on this device and is never uploaded', async () => {
    await write('config.json', { llmModel: 'local', sync: true });
    await configSyncStore.syncConfigFiles();
    expect(server.has('config.json')).toBe(false);
    expect(await read('config.json')).toEqual({ llmModel: 'local', sync: true });
  });

  test('first sync pushes local files that the server lacks', async () => {
    expect(await configSyncStore.syncConfigFiles()).toEqual({ 'mcp.json': 'pushed', 'auth.json': 'pushed' });
    expect(server.get('mcp.json')?.content).toEqual({ mcpServers: {} });
    // the fl0w login stays on this device
    expect(server.get('auth.json')?.content).toEqual({});
    expect((await stat(join(home, 'sync-state.json'))).mode & 0o777).toBe(0o600);
  });

  test('first sync on a new device lets the server win conflicts and keeps local-only keys', async () => {
    server.set('mcp.json', { version: 3, updatedAt: new Date(0).toISOString(), content: { mcpServers: { remote: { url: 'remote' } } } });
    server.set('auth.json', { version: 1, updatedAt: new Date(0).toISOString(), content: { mcp: { linear: { tokens: { access_token: 't' } } } } });

    const results = await configSyncStore.syncConfigFiles();
    expect(results?.['mcp.json']).toBe('pulled');
    expect(await read('mcp.json')).toEqual({ mcpServers: { remote: { url: 'remote' } } });
    // auth.json gains the remote MCP tokens and keeps this device's login without pushing it
    expect(results?.['auth.json']).toBe('pulled');
    expect(await read('auth.json')).toEqual({ fl0w: fl0wLogin, mcp: { linear: { tokens: { access_token: 't' } } } });
    expect(server.get('auth.json')?.version).toBe(1);
  });

  test('a login refresh during sync does not outrank MCP tokens added on fl0w-work', async () => {
    await configSyncStore.syncConfigFiles();
    const linear = { mcp: { linear: { tokens: { access_token: 't' } } } };
    server.set('auth.json', { version: 2, updatedAt: new Date(Date.now() - 60_000).toISOString(), content: linear });
    // what getAccessToken() writes when the token is near expiry
    const refreshed = { ...fl0wLogin, accessToken: 'a2' };
    await write('auth.json', { fl0w: refreshed });

    expect((await configSyncStore.syncConfigFiles())?.['auth.json']).toBe('pulled');
    expect(await read('auth.json')).toEqual({ fl0w: refreshed, ...linear });
    expect(server.get('auth.json')).toMatchObject({ version: 2, content: linear });
  });

  test('scrubs a fl0w login an older fl0w-cli pushed', async () => {
    server.set('auth.json', { version: 1, updatedAt: new Date(0).toISOString(), content: { fl0w: { ...fl0wLogin, accessToken: 'old' } } });

    expect((await configSyncStore.syncConfigFiles())?.['auth.json']).toBe('pushed');
    expect(await read('auth.json')).toEqual({ fl0w: fl0wLogin });
    expect(server.get('auth.json')).toMatchObject({ version: 2, content: {} });
  });

  test('later syncs only download changed files and push local edits', async () => {
    await configSyncStore.syncConfigFiles();
    requests = [];

    await write('mcp.json', { mcpServers: { demo: { url: 'https://demo' } } });
    expect(await configSyncStore.syncConfigFiles()).toEqual({ 'mcp.json': 'pushed', 'auth.json': 'unchanged' });
    expect(requests.filter((r) => r.startsWith('GET /api/sync/config-files/'))).toEqual([]);
    expect(server.get('mcp.json')).toMatchObject({ version: 2, content: { mcpServers: { demo: { url: 'https://demo' } } } });
  });

  test('pulls a remote change when the local file is untouched', async () => {
    await configSyncStore.syncConfigFiles();
    server.set('mcp.json', { version: 2, updatedAt: new Date().toISOString(), content: { mcpServers: { from: { url: 'web' } } } });

    expect((await configSyncStore.syncConfigFiles())?.['mcp.json']).toBe('pulled');
    expect(await read('mcp.json')).toEqual({ mcpServers: { from: { url: 'web' } } });
  });

  test('retries once against the latest version when another device pushes first', async () => {
    await write('mcp.json', { mcpServers: { base: { url: 'base' } } });
    await configSyncStore.syncConfigFiles();
    await write('mcp.json', { mcpServers: { base: { url: 'base' }, local: { url: 'local' } } });
    await backdate('mcp.json');
    conflictOnce = 'mcp.json';

    expect((await configSyncStore.syncConfigFiles())?.['mcp.json']).toBe('pulled');
    const expected = { mcpServers: { raced: { url: 'raced' } } };
    expect(await read('mcp.json')).toEqual(expected);
    expect(server.get('mcp.json')?.content).toEqual(expected);
  });

  test('syncs when sync-state base or remote content is null', async () => {
    await write('mcp.json', { mcpServers: { local: { url: 'local' } } });
    await configSyncStore.syncConfigFiles();
    await write('sync-state.json', {
      userId: 'u1',
      files: { 'mcp.json': { version: 1, updatedAt: new Date().toISOString(), base: null } },
    });

    expect((await configSyncStore.syncConfigFiles())?.['mcp.json']).not.toBeInstanceOf(Error);
    expect(await read('mcp.json')).toEqual({ mcpServers: { local: { url: 'local' } } });
  });

  test('leaves an invalid local file alone and reports it', async () => {
    await writeFile(join(home, 'mcp.json'), '{ not json');
    const results = await configSyncStore.syncConfigFiles();
    expect(results?.['mcp.json']).toBeInstanceOf(Error);
    expect(await Bun.file(join(home, 'mcp.json')).text()).toBe('{ not json');
    expect(results?.['auth.json']).toBe('pushed');
  });
});
