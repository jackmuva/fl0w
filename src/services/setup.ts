import { flushPendingSkillMirrors } from './skills/mirror-enabled-skills';
import { flushPendingPushes } from './sync/config-sync';
import { flushSessionPushes } from './sync/session-sync';
import { flushWorkflowPushes } from './sync/workflow-sync';
import { syncOnStartup, watchLocalConfigWrites } from './sync/config-sync';
import { syncSessionsInBackground } from './sync/session-sync';
import { syncWorkflowsInBackground } from './sync/workflow-sync';
import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FL0W_HOME } from '../constants';
import type { McpConfig } from '../models/mcp';

const writeDefaultJsonIfMissing = async (path: string, content: unknown): Promise<void> => {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await Bun.write(path, `${JSON.stringify(content, null, 2)}\n`);
};
export async function ensureFl0wHome(home = FL0W_HOME): Promise<void> {
  mkdirSync(home, { recursive: true });
  await mkdir(join(home, 'tools'), { recursive: true });
  await mkdir(join(home, 'skills'), { recursive: true });
  await mkdir(join(home, 'workspace'), { recursive: true });
  await writeDefaultJsonIfMissing(join(home, 'mcp.json'), { mcpServers: {} } satisfies McpConfig);
}

export type StartupSyncOptions = {
  log?: (message: string) => void;
  syncSessions?: boolean;
};

export async function runStartupSync(options: StartupSyncOptions = {}): Promise<string | null> {
  const log = options.log ?? console.log;
  const syncSessions = options.syncSessions ?? true;

  log('Syncing config files...');
  const syncWarning = await syncOnStartup();
  watchLocalConfigWrites();
  log(syncSessions ? 'Syncing workflows and sessions...' : 'Syncing workflows...');
  syncWorkflowsInBackground();
  if (syncSessions) syncSessionsInBackground();
  return syncWarning;
}

export async function finishHeadlessRun(code: number): Promise<number> {
  void flushPendingSkillMirrors();
  await Promise.all([flushPendingPushes(), flushWorkflowPushes(), flushSessionPushes()]);
  return code;
}
