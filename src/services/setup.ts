import { flushPendingSkillMirrors } from './skills/mirror-enabled-skills';
import { flushPendingPushes } from './sync/config-sync';
import { syncOnStartup, watchLocalConfigWrites } from './sync/config-sync';
import { drainOutboxInBackground, flushOutbox } from './sync/outbox';
import { readFl0wAuth } from './auth/token';
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
};

/** Sessions and workflows live on fl0w-work, so the TUI and headless runs need a signed-in user. */
export async function requireLogin(): Promise<boolean> {
  if (await readFl0wAuth()) return true;
  console.error('Not logged in. Run `fl0w login` first.');
  return false;
}

export async function runStartupSync(options: StartupSyncOptions = {}): Promise<string | null> {
  const log = options.log ?? console.log;

  log('Syncing config files...');
  const syncWarning = await syncOnStartup();
  watchLocalConfigWrites();
  // pushes writes left over from earlier runs (offline, crashed, or still debouncing at exit)
  drainOutboxInBackground();
  return syncWarning;
}

export async function finishHeadlessRun(code: number): Promise<number> {
  void flushPendingSkillMirrors();
  await Promise.all([flushPendingPushes(), flushOutbox()]);
  return code;
}
