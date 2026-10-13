import { describe, expect, test } from 'bun:test';
import type { JevMessage } from '../models/agent';
import { emptyCapabilitySelection } from '../services/agent/capabilities';
import type { FlowDatabase } from './schema';
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
    const seed: JevMessage[] = [{ message: { role: 'system', content: 'rules' } }];
    const conversation: JevMessage[] = [
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

  test('loads messages saved before JevMessage', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-legacy');
    const legacy = { role: 'user', content: 'old' };
    (store as unknown as { db: FlowDatabase }).db.$client.run(
      'INSERT INTO messages (session_id, position, payload) VALUES (?, ?, ?)',
      [session.id, 0, JSON.stringify(legacy)],
    );

    expect(store.loadMessages(session.id)).toEqual([{ message: legacy }] as JevMessage[]);
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

  test('clears saved messages when only system messages remain', () => {
    const store = SessionStore.openInMemory();
    const session = store.getOrCreateSession('/tmp/project-d');
    const seed: JevMessage[] = [{ message: { role: 'system', content: 'rules' } }];

    store.saveMessages(session.id, [
      ...seed,
      { message: { role: 'user', content: 'hello' } },
    ]);
    store.saveMessages(session.id, seed);

    expect(store.loadMessages(session.id)).toEqual([]);
  });
});
