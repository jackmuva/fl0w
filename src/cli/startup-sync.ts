import { isConfigSyncEnabled } from '../services/config/app-config';
import { syncOnStartup, watchLocalConfigWrites } from '../services/sync/config-sync';
import { syncSessionsInBackground } from '../services/sync/session-sync';
import { syncWorkflowsInBackground } from '../services/sync/workflow-sync';

export type StartupSyncOptions = {
  log?: (message: string) => void;
  /** When false (e.g. `fl0w session --remote`), workflows still sync but sessions do not. */
  syncSessions?: boolean;
};

/** Pull/push config and kick off background workflow (and optionally session) sync. */
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
