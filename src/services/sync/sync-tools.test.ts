import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'tool-sync');
const toolsDir = join(home, 'tools');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  FL0W_HOME: home,
  USER_TOOLS_DIR: toolsDir,
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
  BUNDLE_SYNC_STATE_PATH: join(home, 'bundle-sync-state.json'),
  SYNC_CONFLICTS_DIR: join(home, 'sync-conflicts'),
}));
const { AUTH_PATH, BUNDLE_SYNC_STATE_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home) || !BUNDLE_SYNC_STATE_PATH.startsWith(home)) throw new Error('tool-sync test is not isolated');
const { userToolLoader } = await import('../external-tools/user-tool-service');
const { syncToolService } = await import('./sync-tools');
const { packFiles } = await import('./bundle-sync');

type ServerTool = { contentHash: string, size: number, bundle: Uint8Array, updatedAt: string };
let server: Map<string, ServerTool>;
let requests: string[];
const realFetch = globalThis.fetch;

const meta = (name: string, tool: ServerTool) => ({ name, contentHash: tool.contentHash, size: tool.size, updatedAt: tool.updatedAt });

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://fl0w.test' || !url.pathname.startsWith('/api/sync/tools')) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${url.pathname}`);
  const name = url.pathname === '/api/sync/tools' ? null : decodeURIComponent(url.pathname.split('/').pop()!);
  if (!name) return Response.json({ tools: [...server].map(([n, tool]) => meta(n, tool)) });

  const existing = server.get(name);
  if (method === 'GET') {
    if (!existing) return Response.json({ error: 'not_found' }, { status: 404 });
    return new Response(existing.bundle.slice(), { headers: { 'x-tool-content-hash': existing.contentHash } });
  }
  if (method === 'DELETE') {
    server.delete(name);
    return new Response(null, { status: existing ? 204 : 404 });
  }
  const headers = new Headers(init!.headers);
  const bundle = (init!.body as Uint8Array).slice();
  const tool = { contentHash: headers.get('x-tool-content-hash')!, size: bundle.byteLength, bundle, updatedAt: new Date().toISOString() };
  server.set(name, tool);
  return Response.json({ tool: meta(name, tool) });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const writeJson = (name: string, value: unknown) => writeFile(join(home, name), JSON.stringify(value));

const toolSource = (name: string) => `import { greet } from './_helpers';
export const name = '${name}';
export const description = '${name} description';
export const inputSchema = { type: 'object', properties: {} };
export const execute = async () => greet('${name}');
`;

beforeAll(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(toolsDir, { recursive: true });
  await writeFile(join(toolsDir, '_helpers.ts'), 'export const greet = (who: string) => `hi ${who}`;\n');
  await writeFile(join(toolsDir, 'weather.ts'), toolSource('weather'));
  await writeFile(join(toolsDir, 'stocks.ts'), toolSource('stocks'));
  await writeFile(join(toolsDir, '_cert.pem'), 'pem');
  await writeFile(join(toolsDir, '.env'), 'TOKEN=x');
  await userToolLoader.loadUserTools(toolsDir);
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(home, 'auth.json'), { force: true });
  await rm(join(home, 'config.json'), { force: true });
  await rm(join(home, 'bundle-sync-state.json'), { force: true });
  server = new Map();
  requests = [];
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('packUserTool', () => {
  test('bundles the tool file with the _-prefixed helpers, not other tools or secrets', async () => {
    const packed = await syncToolService.packUserTool('weather.ts');
    expect(packed.files).toEqual(['_helpers.ts', 'weather.ts']);

    const unpacked = await new Bun.Archive(packed.bundle).files();
    expect([...unpacked.keys()].sort()).toEqual(['_helpers.ts', 'weather.ts']);
    expect(await unpacked.get('weather.ts')!.text()).toBe(toolSource('weather'));
  });
});

describe('syncAllTools', () => {
  test('does nothing when signed out', async () => {
    expect(await syncToolService.syncAllTools()).toBeNull();
    expect(requests).toEqual([]);
  });

  test('uploads every loaded tool by exported name once and skips them while unchanged', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });

    expect(await syncToolService.syncAllTools()).toEqual({ weather: 'pushed', stocks: 'pushed' });
    expect([...server.keys()].sort()).toEqual(['stocks', 'weather']);

    requests = [];
    expect(await syncToolService.syncAllTools()).toEqual({ weather: 'unchanged', stocks: 'unchanged' });
    expect(requests).toEqual(['GET /api/sync/tools']);

    // a helper change re-uploads the tools that may import it
    await writeFile(join(toolsDir, '_helpers.ts'), 'export const greet = (who: string) => `hello ${who}`;\n');
    expect(await syncToolService.syncAllTools()).toEqual({ weather: 'pushed', stocks: 'pushed' });
  });
});

describe('syncAllTools pull', () => {
  test('pulls a tool made on the remote computer and loads it, and deletes only its own file when fl0w-work does', async () => {
    await writeJson('auth.json', { fl0w: fl0wLogin });
    expect(await syncToolService.syncAllTools()).toEqual({ weather: 'pushed', stocks: 'pushed' });

    const src = join(home, 'remote-src');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'news.ts'), toolSource('news'));
    await writeFile(join(src, '_helpers.ts'), await readFile(join(toolsDir, '_helpers.ts'), 'utf8'));
    const packed = await packFiles(src, ['_helpers.ts', 'news.ts']);
    server.set('news', { contentHash: packed.contentHash, size: packed.bundle.byteLength, bundle: packed.bundle, updatedAt: new Date().toISOString() });

    expect(await syncToolService.syncAllTools()).toEqual({ news: 'pulled', weather: 'unchanged', stocks: 'unchanged' });
    expect(await readFile(join(toolsDir, 'news.ts'), 'utf8')).toBe(toolSource('news'));
    expect(userToolLoader.getUserToolSourceFile('news')).toBe('news.ts');

    server.delete('news');
    expect((await syncToolService.syncAllTools())?.news).toBe('deleted');
    expect((await readdir(toolsDir)).sort()).toEqual(['.env', '_cert.pem', '_helpers.ts', 'stocks.ts', 'weather.ts']);
  });
});
