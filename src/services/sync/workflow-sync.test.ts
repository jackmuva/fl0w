import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'workflow-sync');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
}));
const { AUTH_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home)) throw new Error('workflow-sync test is not isolated');
const { syncWorkflows } = await import('./workflow-sync');
const { WorkflowStore } = await import('../../db/workflow-store');
const { emptyCapabilitySelection } = await import('../agent/capabilities');

let server: Map<string, Record<string, unknown>>;
let requests: string[];
const realFetch = globalThis.fetch;

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const [, id] = url.pathname.match(/^\/api\/sync\/workflows(?:\/(.+))?$/) ?? [];
  if (url.origin !== 'https://fl0w.test' || !url.pathname.startsWith('/api/sync/workflows')) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(id ? `${method} ${decodeURIComponent(id)}` : method);
  if (method === 'GET' && id) {
    const workflow = server.get(decodeURIComponent(id));
    return workflow ? Response.json({ workflow }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (method === 'GET') return Response.json({ workflows: [...server.values()].map(({ id, updatedAt }) => ({ id, updatedAt })) });
  const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
  if (server.has(body.id as string)) return Response.json({ error: 'conflict' }, { status: 409 });
  server.set(body.id as string, body);
  return Response.json({ workflow: body }, { status: 201 });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const write = (name: string, value: unknown) => writeFile(join(home, name), JSON.stringify(value));
const save = (store: ReturnType<typeof WorkflowStore.openInMemory>, title: string) => store.saveWorkflow({
  title,
  goal: `${title} goal`,
  steps: [{ intent: 'do it', action: 'run', toolParameters: { a: 'b' } }],
  requiredCapabilities: emptyCapabilitySelection(),
});

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

describe('syncWorkflows', () => {
  test('does nothing when signed out', async () => {
    const store = WorkflowStore.openInMemory();
    save(store, 'Local only');
    expect(await syncWorkflows(store)).toBeNull();
    expect(requests).toEqual([]);
  });

  test('does nothing when sync is disabled', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    await write('config.json', { sync: false });
    const store = WorkflowStore.openInMemory();
    save(store, 'Local only');
    expect(await syncWorkflows(store)).toBeNull();
    expect(requests).toEqual([]);
  });

  test('pushes only workflows missing on the server, with the local row shape', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = WorkflowStore.openInMemory();
    const existing = save(store, 'Already synced');
    const fresh = save(store, 'New one');
    server.set(existing.id, { ...existing });

    expect(await syncWorkflows(store)).toEqual({ pushed: 1, pulled: 0 });
    expect(requests).toEqual(['GET', 'POST']);
    expect(server.get(fresh.id)).toEqual({ ...fresh });

    requests = [];
    expect(await syncWorkflows(store)).toEqual({ pushed: 0, pulled: 0 });
    expect(requests).toEqual(['GET']);
  });

  test('pulls workflows missing locally, with the remote row shape', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const remote = save(WorkflowStore.openInMemory(), 'From another device');
    server.set(remote.id, { ...remote });
    const store = WorkflowStore.openInMemory();

    expect(await syncWorkflows(store)).toEqual({ pushed: 0, pulled: 1 });
    expect(requests).toEqual(['GET', `GET ${remote.id}`]);
    expect(store.getWorkflow(remote.id)).toEqual(remote);

    requests = [];
    expect(await syncWorkflows(store)).toEqual({ pushed: 0, pulled: 0 });
    expect(requests).toEqual(['GET']);
  });

  test('skips a workflow deleted on the server between list and pull', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = WorkflowStore.openInMemory();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/api/sync/workflows') return Response.json({ workflows: [{ id: 'gone', updatedAt: 'x' }] });
      return fakeFetch(input, init);
    }) as typeof fetch;

    expect(await syncWorkflows(store)).toEqual({ pushed: 0, pulled: 0 });
    expect(store.listWorkflows()).toEqual([]);
  });

  test('treats a 409 race as already synced', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = WorkflowStore.openInMemory();
    const workflow = save(store, 'Raced');
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ workflows: [] });
      server.set(workflow.id, { ...workflow });
      return fakeFetch(input, init);
    }) as typeof fetch;

    expect(await syncWorkflows(store)).toEqual({ pushed: 0, pulled: 0 });
  });
});
