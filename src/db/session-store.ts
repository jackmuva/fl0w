import { asc, desc, eq, sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { DB_PATH } from '../constants';
import type { CapabilitySelection, Fl0wMessage } from '../models/agent';
import { messages, nowIso, openDatabase, sessions, type FlowDatabase } from './schema';

export type SessionRecord = typeof sessions.$inferSelect;

const deriveTitle = (messages: Fl0wMessage[]): string | null => {
  const firstUser = messages.find(({ message }) => message.role === 'user')?.message;
  if (!firstUser) return null;

  const text = typeof firstUser.content === 'string'
    ? firstUser.content
    : Array.isArray(firstUser.content)
      ? firstUser.content
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
      : '';

  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
};

export class SessionStore {
  private readonly db: FlowDatabase;

  private constructor(db: FlowDatabase) {
    this.db = db;
  }

  static open(path = DB_PATH): SessionStore {
    return new SessionStore(openDatabase(path));
  }

  static openInMemory(): SessionStore {
    return new SessionStore(openDatabase(':memory:'));
  }

  listSessions(workspacePath: string): SessionRecord[] {
    return this.db.select().from(sessions)
      .where(eq(sessions.workspacePath, resolve(workspacePath)))
      .orderBy(desc(sessions.updatedAt))
      .all();
  }

  /** Every workspace's sessions, for syncing with fl0w-work. */
  listAllSessions(): SessionRecord[] {
    return this.db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
  }

  createSession(workspacePath: string, id?: string): SessionRecord {
    const now = nowIso();
    const session: SessionRecord = {
      id: id ?? crypto.randomUUID(),
      workspacePath: resolve(workspacePath),
      title: null,
      capabilities: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(sessions).values(session).run();
    return session;
  }

  /** In-memory session id until the first save; not written to SQLite yet. */
  createDraftSession(workspacePath: string): SessionRecord {
    const now = nowIso();
    return {
      id: crypto.randomUUID(),
      workspacePath: resolve(workspacePath),
      title: null,
      capabilities: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  hasSession(id: string): boolean {
    return this.db.select({ id: sessions.id }).from(sessions)
      .where(eq(sessions.id, id))
      .get() != null;
  }

  /** Most recently updated session that has saved conversation messages. */
  findLatestSessionWithMessages(workspacePath: string): SessionRecord | null {
    for (const session of this.listSessions(workspacePath)) {
      if (this.loadMessages(session.id).length > 0) return session;
    }
    return null;
  }

  /** Removes empty rows left over from older builds that created sessions at startup. */
  deleteEmptySessions(workspacePath: string): void {
    for (const session of this.listSessions(workspacePath)) {
      if (this.loadMessages(session.id).length > 0) continue;
      if (session.capabilities != null) continue;
      this.deleteSession(session.id);
    }
  }

  getOrCreateSession(workspacePath: string): SessionRecord {
    const existing = this.db.select().from(sessions)
      .where(eq(sessions.workspacePath, resolve(workspacePath)))
      .orderBy(desc(sessions.updatedAt))
      .limit(1)
      .get();

    return existing ?? this.createSession(workspacePath);
  }

  loadMessages(sessionId: string): Fl0wMessage[] {
    return this.db.select({ payload: messages.payload }).from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.position))
      .all()
      .map(({ payload }) => ('message' in payload ? payload : { message: payload }));
  }

  getCapabilities(sessionId: string): CapabilitySelection | null {
    const row = this.db.select({ capabilities: sessions.capabilities }).from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    return row?.capabilities ?? null;
  }

  saveCapabilities(sessionId: string, capabilities: CapabilitySelection): void {
    this.db.update(sessions)
      .set({ capabilities, updatedAt: nowIso() })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  saveMessages(sessionId: string, fl0wMessages: Fl0wMessage[]): void {
    const conversation = fl0wMessages.filter(({ message }) => message.role !== 'system');
    const title = deriveTitle(conversation);

    this.db.transaction((tx) => {
      tx.delete(messages).where(eq(messages.sessionId, sessionId)).run();
      if (conversation.length > 0) {
        tx.insert(messages)
          .values(conversation.map((payload, position) => ({ sessionId, position, payload })))
          .run();
      }
      tx.update(sessions)
        .set({ updatedAt: nowIso(), title: sql`COALESCE(${title}, ${sessions.title})` })
        .where(eq(sessions.id, sessionId))
        .run();
    }, { behavior: 'immediate' });
  }

  deleteSession(sessionId: string): boolean {
    return this.db.transaction((tx) => {
      tx.delete(messages).where(eq(messages.sessionId, sessionId)).run();
      const result = tx.delete(sessions).where(eq(sessions.id, sessionId)).run();
      return result.changes > 0;
    }, { behavior: 'immediate' });
  }

  /** Writes a session synced from fl0w-work as-is, keeping its `updatedAt` so the next sync sees both sides as equal. */
  importSession({ messages: fl0wMessages, ...session }: SessionRecord & { messages: Fl0wMessage[] }): void {
    const { id, ...fields } = session;
    this.db.transaction((tx) => {
      tx.insert(sessions).values(session).onConflictDoUpdate({ target: sessions.id, set: fields }).run();
      tx.delete(messages).where(eq(messages.sessionId, id)).run();
      if (fl0wMessages.length > 0) {
        tx.insert(messages)
          .values(fl0wMessages.map((payload, position) => ({ sessionId: id, position, payload })))
          .run();
      }
    }, { behavior: 'immediate' });
  }
}
