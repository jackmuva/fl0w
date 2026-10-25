import type { CapabilitySelection } from '../../models/agent';
import { discoverSkills } from '../agent/hooks/front-load';
import { emptyCapabilitySelection } from '../agent/config';
import { listUserTools, loadUserTools } from '../agent/user-tools/loader';
import { syncEnabledTools, type ToolSyncResults } from '../agent/user-tools/sync-tools';
import { mirrorEnabledSkills } from '../skills/mirror-enabled-skills';
import { syncEnabledSkills, type SkillSyncResults } from '../skills/sync-skills';
import { readFl0wAuth } from '../auth/token';
import { syncConfigFiles, type SyncResults } from './config-sync';
import { flushOutbox, pendingOps } from './outbox';

export type FullSyncSkipReason = 'not-signed-in' | 'sync-disabled';

export type FullSyncResult = {
  skipped: FullSyncSkipReason | null;
  config: SyncResults | null;
  /** Session and workflow writes still waiting in the outbox after trying to push them. */
  pendingWrites: number | null;
  skills: SkillSyncResults | null;
  tools: ToolSyncResults | null;
};

/** Syncs config, auth, MCP config, and every local skill and user tool with fl0w-work, and pushes pending session and workflow writes. */
export async function runFullSync(): Promise<FullSyncResult> {
  const empty: FullSyncResult = {
    skipped: null,
    config: null,
    pendingWrites: null,
    skills: null,
    tools: null,
  };

  if (!(await readFl0wAuth())) return { ...empty, skipped: 'not-signed-in' };

  const config = await syncConfigFiles();
  await flushOutbox();
  const pendingWrites = pendingOps().length;

  const catalog = await discoverSkills();
  await loadUserTools();
  const selection: CapabilitySelection = {
    ...emptyCapabilitySelection(),
    skills: catalog.map((skill) => skill.name),
    userTools: listUserTools().map((tool) => tool.name),
  };
  await mirrorEnabledSkills(selection, catalog);
  const skills = await syncEnabledSkills(selection, catalog);
  const tools = await syncEnabledTools(selection);

  return { skipped: null, config, pendingWrites, skills, tools };
}
