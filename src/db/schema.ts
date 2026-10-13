import { Database } from 'bun:sqlite';
import type { ModelMessage } from 'ai';
import { desc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mkdirSync } from 'node:fs';
import { DB_PATH, JEV_HOME } from '../constants';
import type { CapabilitySelection, JevMessage } from '../models/agent';
import type { WorkflowStep } from '../models/workflow';

export const nowIso = (): string => new Date().toISOString();

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  workspacePath: text('workspace_path').notNull(),
  title: text('title'),
  capabilities: text('capabilities', { mode: 'json' }).$type<CapabilitySelection>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_sessions_workspace_updated').on(table.workspacePath, desc(table.updatedAt)),
]);

export const messages = sqliteTable('messages', {
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  // Sessions saved before JevMessage stored bare ModelMessages.
  payload: text('payload', { mode: 'json' }).$type<JevMessage | ModelMessage>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.position] }),
]);

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  sourceSessionId: text('source_session_id').references(() => sessions.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  steps: text('steps', { mode: 'json' }).$type<WorkflowStep[]>().notNull(),
  requiredCapabilities: text('required_capabilities', { mode: 'json' }).$type<CapabilitySelection>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_workflows_updated').on(desc(table.updatedAt)),
]);

export type FlowDatabase = ReturnType<typeof openDatabase>;

// Idempotent DDL (mirrors the tables above) so existing user databases and the
// compiled binary work without shipping a drizzle-kit migrations folder.
export const openDatabase = (path = DB_PATH) => {
  if (path !== ':memory:') mkdirSync(JEV_HOME, { recursive: true });
  const db = drizzle({ client: new Database(path, { create: true }) });

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      title TEXT,
      capabilities TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
    ON sessions (workspace_path, updated_at DESC)
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (session_id, position),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      source_session_id TEXT,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      steps TEXT NOT NULL,
      required_capabilities TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL
    )
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_updated
    ON workflows (updated_at DESC)
  `);
  db.run(sql`PRAGMA journal_mode = WAL`);

  return db;
};
