import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionWorkspacePath } from '../constants';
import type { Fl0wMessage } from '../models/agent';
import { emptyCapabilitySelection } from '../services/agent/config';
import { nextUpdatedAt, type FlowDatabase } from './schema';
import { SessionStore } from './session-store';

describe('SessionStore', () => {
  test('creates and resumes a workspace session', () => {
    const store = SessionStore.openInMemory();
    const first = store.getOrCreateSession('/tmp/project-a');
    const second = store.getOrCreateSession('/tmp/project-a');

    expect(second.id).toBe(first.id);
  });

  test('persists non-system messages in order', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-b');
    const seed: Fl0wMessage[] = [{ message: { role: 'system', content: 'rules' } }];
    const conversation: Fl0wMessage[] = [
      { message: { role: 'user', content: 'hello' } },
      { message: { role: 'assistant', content: 'hi there' } },
    ];

    store.saveMessages(session.id, [...seed, ...conversation]);
    const loaded = store.loadMessages(session.id);

    expect(loaded).toEqual(conversation);
  });

  test('replaces messages on save', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-c');

    store.saveMessages(session.id, [{ message: { role: 'user', content: 'first' } }]);
    store.saveMessages(session.id, [
      { message: { role: 'user', content: 'first' } },
      { message: { role: 'assistant', content: 'second' } },
    ]);

    expect(store.loadMessages(session.id)).toEqual([
      { message: { role: 'user', content: 'first' } },
      { message: { role: 'assistant', content: 'second' } },
    ]);
  });

  test('lists sessions for a workspace ordered by most recently updated', async () => {
    const store = SessionStore.openInMemory();
    const workspace = '/tmp/project-list';
    const first = store.createSession(workspace);
    const second = store.createSession(workspace);

    store.saveMessages(first.id, [{ message: { role: 'user', content: 'first session' } }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.saveMessages(second.id, [{ message: { role: 'user', content: 'second session' } }]);

    const sessions = store.listSessions(workspace);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe(second.id);
    expect(sessions[1]?.id).toBe(first.id);
  });

  test('loads messages saved before fl0wMessage', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-legacy');
    const legacy = { role: 'user', content: 'old' };
    (store as unknown as { db: FlowDatabase }).db.$client.run(
      'INSERT INTO messages (session_id, position, payload) VALUES (?, ?, ?)',
      [session.id, 0, JSON.stringify(legacy)],
    );

    expect(store.loadMessages(session.id)).toEqual([{ message: legacy }] as Fl0wMessage[]);
  });

  test('persists and loads session capabilities', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-caps');
    const capabilities = emptyCapabilitySelection();
    capabilities.skills = ['demo-skill'];
    capabilities.mcpServers = ['github'];

    store.saveCapabilities(session.id, capabilities);

    expect(store.getCapabilities(session.id)).toEqual(capabilities);
    expect(store.listSessions('/tmp/project-caps')[0]?.capabilities).toEqual(capabilities);
  });

  test('deletes a session and its messages', () => {
    const store = SessionStore.openInMemory();
    const workspace = '/tmp/project-delete';
    const session = store.createSession(workspace);

    store.saveMessages(session.id, [{ message: { role: 'user', content: 'hello' } }]);
    expect(store.deleteSession(session.id)).toBe(true);
    expect(store.listSessions(workspace)).toHaveLength(0);
    expect(store.loadMessages(session.id)).toEqual([]);
    expect(store.deleteSession(session.id)).toBe(false);
  });

  test('deletes the session workspace folder', () => {
    const store = SessionStore.openInMemory();
    const session = store.createSession('/tmp/project-delete-workspace');
    const dir = sessionWorkspacePath(session.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'default_bash-call-1.txt'), 'output');

    expect(store.deleteSession(session.id)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  test('draft sessions are not persisted until createSession', () => {
    const store = SessionStore.openInMemory();
    const workspace = '/tmp/project-draft';
    const draft = store.createDraftSession(workspace);

    expect(store.hasSession(draft.id)).toBe(false);
    expect(store.listSessions(workspace)).toHaveLength(0);

    const persisted = store.createSession(workspace, draft.id);
    expect(persisted.id).toBe(draft.id);
    expect(store.hasSession(draft.id)).toBe(true);
  });

  test('findLatestSessionWithMessages skips empty sessions', () => {
    const store = SessionStore.openInMemory();
    const workspace = '/tmp/project-latest';
    store.createSession(workspace);
    const withMessages = store.createSession(workspace);
    store.saveMessages(withMessages.id, [{ message: { role: 'user', content: 'hello' } }]);

    expect(store.findLatestSessionWithMessages(workspace)?.id).toBe(withMessages.id);
  });

  test('clears saved messages when only system messages remain', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-d');
    const seed: Fl0wMessage[] = [{ message: { role: 'system', content: 'rules' } }];

    store.saveMessages(session.id, [
      ...seed,
      { message: { role: 'user', content: 'hello' } },
    ]);
    store.saveMessages(session.id, seed);

    expect(store.loadMessages(session.id)).toEqual([]);
  });
});

describe('nextUpdatedAt', () => {
  test('bumps past a same-millisecond previous value', () => {
    const previous = new Date(Date.now() + 50).toISOString();
    expect(nextUpdatedAt(previous)).toBe(new Date(Date.parse(previous) + 1).toISOString());
  });

  test('falls back to the clock for unparseable or far-future values', () => {
    const before = Date.now();
    expect(Date.parse(nextUpdatedAt('abc'))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(nextUpdatedAt('2999-01-01T00:00:00.000Z'))).toBeLessThan(before + 1_000);
  });
});
