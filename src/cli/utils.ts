import { flushPendingSkillMirrors } from '../services/skills/mirror-enabled-skills';
import { flushPendingPushes } from '../services/sync/config-sync';
import { flushSessionPushes } from '../services/sync/session-sync';
import { flushWorkflowPushes } from '../services/sync/workflow-sync';
import { isConfigSyncEnabled } from '../services/config/app-config';
import { syncOnStartup, watchLocalConfigWrites } from '../services/sync/config-sync';
import { syncSessionsInBackground } from '../services/sync/session-sync';
import { syncWorkflowsInBackground } from '../services/sync/workflow-sync';

export type StartupSyncOptions = {
  log?: (message: string) => void;
  syncSessions?: boolean;
};

export async function runStartupSync(options: StartupSyncOptions = {}): Promise<string | null> {
  const log = options.log ?? console.log;
  const syncSessions = options.syncSessions ?? true;
  if (!(await isConfigSyncEnabled())) return null;

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
