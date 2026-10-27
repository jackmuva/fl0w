import type { CapabilitySelection } from '../../models/agent';
import { skillService } from '../external-tools/skill-service';
import { emptyCapabilitySelection } from '../capabilities';
import { userToolLoader } from '../external-tools/user-tool-service';
import { syncToolService, type ToolSyncResults } from './sync-tools';
import { syncSkillService, type SkillSyncResults } from './sync-skills';
import { authService } from '../auth/auth-service';
import { configSyncStore, type SyncResults } from './config-sync';
import { outboxStore } from './outbox';

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

  if (!(await authService.readFl0wAuth())) return { ...empty, skipped: 'not-signed-in' };

  const config = await configSyncStore.syncConfigFiles();
  await outboxStore.flushOutbox();
  const pendingWrites = outboxStore.pendingOps().length;

  const catalog = await skillService.discoverSkills();
  await userToolLoader.loadUserTools();
  const selection: CapabilitySelection = {
    ...emptyCapabilitySelection(),
    skills: catalog.map((skill) => skill.name),
    userTools: userToolLoader.listUserTools().map((tool) => tool.name),
  };
  await syncSkillService.mirrorEnabledSkills(selection, catalog);
  const skills = await syncSkillService.syncEnabledSkills(selection, catalog);
  const tools = await syncToolService.syncEnabledTools(selection);

  return { skipped: null, config, pendingWrites, skills, tools };
}
