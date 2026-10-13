import { asc, desc, eq, sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { DB_PATH } from '../constants';
import type { CapabilitySelection, JevMessage } from '../models/agent';
import { messages, nowIso, openDatabase, sessions, type FlowDatabase } from './schema';

export type SessionRecord = typeof sessions.$inferSelect;

const deriveTitle = (messages: JevMessage[]): string | null => {
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

  createSession(workspacePath: string): SessionRecord {
    const now = nowIso();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      workspacePath: resolve(workspacePath),
      title: null,
      capabilities: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(sessions).values(session).run();
    return session;
  }

  getOrCreateSession(workspacePath: string): SessionRecord {
    const existing = this.db.select().from(sessions)
      .where(eq(sessions.workspacePath, resolve(workspacePath)))
      .orderBy(desc(sessions.updatedAt))
      .limit(1)
      .get();

    return existing ?? this.createSession(workspacePath);
  }

  loadMessages(sessionId: string): JevMessage[] {
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

  saveMessages(sessionId: string, jevMessages: JevMessage[]): void {
    const conversation = jevMessages.filter(({ message }) => message.role !== 'system');
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
}
