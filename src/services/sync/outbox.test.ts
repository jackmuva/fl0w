import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';
import type { StoredSession } from '../../models/session';
import type { WorkflowRecord } from '../../models/workflow';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME
const home = join(import.meta.dir, '__fixtures__', 'outbox');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
  OUTBOX_DIR: join(home, 'outbox'),
  WORKSPACE_DIR: join(home, 'workspace'),
  sessionWorkspacePath: (id: string) => join(home, 'workspace', id),
}));
const { AUTH_PATH, OUTBOX_DIR } = await import('../../constants');
if (!AUTH_PATH.startsWith(home)) throw new Error('outbox test is not isolated');
const { outboxStore } = await import('./outbox');
const { deleteSession, getSession, listSessions, saveSession } = await import('../../store/session-store');
const { createDraftSession } = await import('../session-record');
const { deleteWorkflow, listWorkflows, saveWorkflow } = await import('../../store/workflow-store');

let sessions: Map<string, StoredSession>;
let workflows: Map<string, WorkflowRecord>;
let requests: string[];
let offline: boolean;
const realFetch = globalThis.fetch;

/** fl0w-work's sync routes, including the 409 when it already holds a session at least as new. */
const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  if (offline) throw new TypeError('fetch failed');
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const [, kind, rawId] = url.pathname.match(/^\/api\/sync\/(sessions|workflows)(?:\/([^/]+))?$/) ?? [];
  if (url.origin !== 'https://fl0w.test' || !kind) throw new Error(`unexpected request ${url}`);
  const id = rawId && decodeURIComponent(rawId);
  requests.push(`${method} ${kind}${id ? ` ${id}` : ''}`);

  if (kind === 'sessions') {
    if (!id) {
      const workspacePath = url.searchParams.get('workspacePath');
      const rows = [...sessions.values()]
        .filter((s) => !workspacePath || s.workspacePath === workspacePath)
        .map(({ messages, ...s }) => ({ ...s, messageCount: messages.length }));
      return Response.json({ sessions: rows });
    }
    if (method === 'GET') {
      const session = sessions.get(id);
      return session ? Response.json({ session }) : Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (method === 'DELETE') {
      return sessions.delete(id) ? new Response(null, { status: 204 }) : Response.json({ error: 'not_found' }, { status: 404 });
    }
    const body = JSON.parse(String(init!.body)) as Omit<StoredSession, 'id'>;
    const existing = sessions.get(id);
    if (existing && existing.updatedAt >= body.updatedAt) return Response.json({ error: 'conflict' }, { status: 409 });
    sessions.set(id, { id, ...body });
    return Response.json({ session: { id, updatedAt: body.updatedAt } });
  }

  if (!id && method === 'GET') return Response.json({ workflows: [...workflows.values()] });
  if (!id) {
    const body = JSON.parse(String(init!.body)) as WorkflowRecord;
    if (workflows.has(body.id)) return Response.json({ error: 'conflict' }, { status: 409 });
    workflows.set(body.id, body);
    return Response.json({ workflow: body }, { status: 201 });
  }
  if (method === 'DELETE') {
    return workflows.delete(id) ? new Response(null, { status: 204 }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  const workflow = workflows.get(id);
  return workflow ? Response.json({ workflow }) : Response.json({ error: 'not_found' }, { status: 404 });
};

const fl0wLogin = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, user: { id: 'u1', email: 'a@b.c' } };
const userMessage = (text: string) => ({ message: { role: 'user' as const, content: text } });
const outboxFiles = () => (existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR) : []);
const workflowInput = (title: string) => ({
  title,
  goal: 'goal',
  steps: [{ index: 1, description: 'd', instructions: 'i' }],
  requiredCapabilities: { skills: [], mcpServers: [], userTools: [], agentsMd: [] },
  models: null,
});

beforeEach(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'auth.json'), JSON.stringify({ fl0w: fl0wLogin }));
  sessions = new Map();
  workflows = new Map();
  requests = [];
  offline = false;
  globalThis.fetch = fakeFetch as typeof fetch;
});

afterEach(async () => {
  await outboxStore.flushOutbox();
  globalThis.fetch = realFetch;
  await rm(home, { recursive: true, force: true });
});

describe('outbox', () => {
  test('coalesces saves of one session into a single push of the latest copy', async () => {
    let session = createDraftSession('/work');
    session = saveSession(session, [userMessage('one')]);
    session = saveSession(session, [userMessage('one'), userMessage('two')]);
    expect(outboxFiles()).toHaveLength(1);

    await outboxStore.flushOutbox();

    expect(requests).toEqual([`PUT sessions ${session.id}`]);
    expect(sessions.get(session.id)?.messages).toHaveLength(2);
    expect(sessions.get(session.id)?.title).toBe('one');
    expect(outboxFiles()).toEqual([]);
  });

  test('does not push a session without a conversation', async () => {
    saveSession(createDraftSession('/work'), [{ message: { role: 'system', content: 'rules' } }]);
    await outboxStore.flushOutbox();
    expect(requests).toEqual([]);
  });

  test('a delete drops a pending save, and later saves of the session are ignored', async () => {
    const session = saveSession(createDraftSession('/work'), [userMessage('hi')]);
    deleteSession(session.id);
    saveSession(session, [userMessage('hi'), userMessage('again')]);
    expect(outboxStore.pendingOps()).toEqual([{ kind: 'delete-session', id: session.id }]);

    await outboxStore.flushOutbox();

    expect(requests).toEqual([`DELETE sessions ${session.id}`]);
    expect(outboxFiles()).toEqual([]);
  });

  test('keeps writes on disk while fl0w-work is unreachable and pushes them later', async () => {
    offline = true;
    const session = saveSession(createDraftSession('/work'), [userMessage('hi')]);
    await outboxStore.flushOutbox();
    expect(outboxFiles()).toHaveLength(1);

    offline = false;
    await outboxStore.flushOutbox();

    expect(sessions.has(session.id)).toBe(true);
    expect(outboxFiles()).toEqual([]);
  });

  test('drops a save fl0w-work refuses because it holds a newer copy', async () => {
    const session = createDraftSession('/work');
    sessions.set(session.id, { ...session, updatedAt: '2999-01-01T00:00:00.000Z', messages: [userMessage('newer')] });
    saveSession(session, [userMessage('older')]);

    await outboxStore.flushOutbox();

    expect(sessions.get(session.id)?.messages).toEqual([userMessage('newer')]);
    expect(outboxFiles()).toEqual([]);
  });

  test('stays on disk without pushing when signed out', async () => {
    await rm(join(home, 'auth.json'));
    saveSession(createDraftSession('/work'), [userMessage('hi')]);
    await outboxStore.flushOutbox();
    expect(requests).toEqual([]);
    expect(outboxFiles()).toHaveLength(1);
  });

  test('removes a corrupt outbox file instead of retrying it forever', async () => {
    await mkdir(OUTBOX_DIR, { recursive: true });
    await writeFile(join(OUTBOX_DIR, 'session-bad.json'), '{not json');
    await outboxStore.flushOutbox();
    expect(outboxFiles()).toEqual([]);
  });
});

describe('session reads', () => {
  test('list and get see unpushed saves on top of fl0w-work', async () => {
    const remote = createDraftSession('/work');
    sessions.set(remote.id, { ...remote, title: 'remote', messages: [userMessage('remote')] });
    sessions.set('elsewhere', { ...createDraftSession('/other', 'elsewhere'), messages: [] });
    offline = true;
    const local = saveSession(createDraftSession('/work'), [userMessage('local')]);
    offline = false;

    const listed = await listSessions('/work');
    expect(listed.map(({ id }) => id).sort()).toEqual([remote.id, local.id].sort());
    expect(listed.find(({ id }) => id === local.id)?.messageCount).toBe(1);
    expect((await getSession(local.id))?.messages).toEqual([userMessage('local')]);
  });

  test('get falls back to an unpushed save when fl0w-work is unreachable', async () => {
    const local = saveSession(createDraftSession('/work'), [userMessage('local')]);
    offline = true;
    expect((await getSession(local.id))?.title).toBe('local');
    await expect(getSession('missing')).rejects.toThrow();
    offline = false;
  });

  test('a pending delete hides the session', async () => {
    const remote = createDraftSession('/work');
    sessions.set(remote.id, { ...remote, messages: [userMessage('hi')] });
    deleteSession(remote.id);
    expect(await listSessions('/work')).toEqual([]);
    expect(await getSession(remote.id)).toBeNull();
  });
});

describe('workflows', () => {
  test('a saved workflow is listed right away and pushed in the background', async () => {
    const saved = saveWorkflow(workflowInput('Report'));
    expect((await listWorkflows()).map(({ id }) => id)).toEqual([saved.id]);

    await outboxStore.flushOutbox();
    expect(workflows.get(saved.id)?.title).toBe('Report');

    deleteWorkflow(saved.id);
    expect(await listWorkflows()).toEqual([]);
    await outboxStore.flushOutbox();
    expect(workflows.size).toBe(0);
  });
});
