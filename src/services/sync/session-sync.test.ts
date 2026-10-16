import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import type { RemoteSession } from '../../models/sync';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'session-sync');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
}));
const { AUTH_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home)) throw new Error('session-sync test is not isolated');
const { syncSessions } = await import('./session-sync');
const { SessionStore } = await import('../../db/session-store');

let server: Map<string, RemoteSession>;
let requests: string[];
const realFetch = globalThis.fetch;

const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const id = url.pathname.match(/^\/api\/sync\/sessions\/([^/]+)$/)?.[1];
  if (url.origin !== 'https://fl0w.test' || (url.pathname !== '/api/sync/sessions' && !id)) throw new Error(`unexpected request ${url}`);
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${id ?? 'list'}`);
  if (!id) return Response.json({ sessions: [...server.values()].map(({ id, updatedAt }) => ({ id, updatedAt })) });
  if (method === 'GET') {
    const session = server.get(id);
    return session ? Response.json({ session }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  const body = JSON.parse(String(init!.body)) as Omit<RemoteSession, 'id'>;
  const existing = server.get(id);
  if (existing && existing.updatedAt >= body.updatedAt) return Response.json({ error: 'conflict' }, { status: 409 });
  server.set(id, { id, ...body });
  return Response.json({ session: { id, updatedAt: body.updatedAt } });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const write = (name: string, value: unknown) => writeFile(join(home, name), JSON.stringify(value));
const userMessage = (text: string) => ({ message: { role: 'user' as const, content: text } });
const converse = (store: ReturnType<typeof SessionStore.openInMemory>, text: string) => {
  const session = store.createSession('/work');
  store.saveMessages(session.id, [userMessage(text)]);
  return store.listAllSessions().find(({ id }) => id === session.id)!;
};

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

describe('syncSessions', () => {
  test('does nothing when signed out', async () => {
    const store = SessionStore.openInMemory();
    converse(store, 'hi');
    expect(await syncSessions(store)).toBeNull();
    expect(requests).toEqual([]);
  });

  test('does nothing when sync is disabled', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    await write('config.json', { sync: false });
    const store = SessionStore.openInMemory();
    converse(store, 'hi');
    expect(await syncSessions(store)).toBeNull();
    expect(requests).toEqual([]);
  });

  test('pushes conversations missing on the server and skips empty sessions', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = SessionStore.openInMemory();
    store.createSession('/work');
    const session = converse(store, 'hello there');

    expect(await syncSessions(store)).toEqual({ pushed: 1, pulled: 0 });
    expect(server.get(session.id)).toEqual({ ...session, messages: [userMessage('hello there')] });

    requests = [];
    expect(await syncSessions(store)).toEqual({ pushed: 0, pulled: 0 });
    expect(requests).toEqual(['GET list']);
  });

  test('pulls sessions that are missing locally or newer on the server, keeping their updatedAt', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = SessionStore.openInMemory();
    const stale = converse(store, 'old');
    const newer: RemoteSession = { ...stale, title: 'continued elsewhere', updatedAt: '2999-01-01T00:00:00.000Z', messages: [userMessage('old'), userMessage('more')] };
    const remoteOnly: RemoteSession = { ...newer, id: 'remote-only', workspacePath: '/sandbox', messages: [userMessage('from sandbox')] };
    server.set(newer.id, newer);
    server.set(remoteOnly.id, remoteOnly);

    expect(await syncSessions(store)).toEqual({ pushed: 0, pulled: 2 });
    const { messages: _newerMessages, ...newerRow } = newer;
    expect(store.listAllSessions().find(({ id }) => id === stale.id)).toEqual(newerRow);
    expect(store.loadMessages(stale.id)).toEqual(newer.messages);
    expect(store.loadMessages('remote-only')).toEqual(remoteOnly.messages);

    requests = [];
    expect(await syncSessions(store)).toEqual({ pushed: 0, pulled: 0 });
    expect(requests).toEqual(['GET list']);
  });

  test('pushes local edits made after a pull', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = SessionStore.openInMemory();
    const session = converse(store, 'first');
    await syncSessions(store);

    store.saveMessages(session.id, [userMessage('first'), userMessage('second')]);
    expect(await syncSessions(store)).toEqual({ pushed: 1, pulled: 0 });
    expect(server.get(session.id)?.messages).toEqual([userMessage('first'), userMessage('second')]);
  });

  test('treats a 409 race as not pushed', async () => {
    await write('auth.json', { fl0w: fl0wLogin });
    const store = SessionStore.openInMemory();
    const session = converse(store, 'raced');
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') server.set(session.id, { ...session, updatedAt: '2999-01-01T00:00:00.000Z', messages: [] });
      return fakeFetch(input, init);
    }) as typeof fetch;

    expect(await syncSessions(store)).toEqual({ pushed: 0, pulled: 0 });
  });
});
