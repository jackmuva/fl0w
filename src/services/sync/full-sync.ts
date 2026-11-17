import { syncToolService, type ToolSyncResults } from './sync-tools';
import { syncSkillService, type SkillSyncResults } from './sync-skills';
import { authService } from '../auth/auth-service';
import { configSyncStore, type SyncResults } from './config-sync';
import { outboxStore } from './outbox';
import { importChromeLogins } from '../browser/browser-session';

export type FullSyncSkipReason = 'not-signed-in' | 'sync-disabled';

export type FullSyncResult = {
  skipped: FullSyncSkipReason | null;
  config: SyncResults | null;
  /** Cookies imported from the user's own Chrome; null when skipped (no Chrome or Chrome data here). */
  chromeImport: number | Error | null;
  /** Session and workflow writes still waiting in the outbox after trying to push them. */
  pendingWrites: number | null;
  skills: SkillSyncResults | null;
  tools: ToolSyncResults | null;
};

/** Imports Chrome logins, then syncs config, auth, MCP config, and every local skill and user tool with fl0w-work, and pushes pending session and workflow writes. */
export async function runFullSync(): Promise<FullSyncResult> {
  const empty: FullSyncResult = {
    skipped: null,
    config: null,
    chromeImport: null,
    pendingWrites: null,
    skills: null,
    tools: null,
  };

  if (!(await authService.readFl0wAuth())) return { ...empty, skipped: 'not-signed-in' };

  const config = await configSyncStore.syncConfigFiles();
  // after the pull, so Chrome's changes merge into the latest browser-state.json, then push it
  const chromeImport = await importChromeLogins().catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
  if (typeof chromeImport === 'number' && chromeImport > 0) {
    const pushed = await configSyncStore.syncConfigFiles(['browser-state.json']);
    if (config && pushed?.['browser-state.json'] !== undefined) config['browser-state.json'] = pushed['browser-state.json'];
  }
  await outboxStore.flushOutbox();
  const pendingWrites = outboxStore.pendingOps().length;

  const skills = await syncSkillService.syncAllSkills();
  const tools = await syncToolService.syncAllTools();

  return { skipped: null, config, chromeImport, pendingWrites, skills, tools };
}
