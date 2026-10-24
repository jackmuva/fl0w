import type { CapabilitySelection } from '../../models/agent';
import { discoverSkills } from '../agent/hooks/front-load';
import { emptyCapabilitySelection } from '../agent/config';
import { listUserTools, loadUserTools } from '../agent/user-tools/loader';
import { syncEnabledTools, type ToolSyncResults } from '../agent/user-tools/sync-tools';
import { mirrorEnabledSkills } from '../skills/mirror-enabled-skills';
import { syncEnabledSkills, type SkillSyncResults } from '../skills/sync-skills';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../setup';
import { syncConfigFiles, type SyncResults } from './config-sync';
import { syncSessions, type SessionSyncResult } from './session-sync';
import { syncWorkflows, type WorkflowSyncResult } from './workflow-sync';

export type FullSyncSkipReason = 'not-signed-in' | 'sync-disabled';

export type FullSyncResult = {
  skipped: FullSyncSkipReason | null;
  config: SyncResults | null;
  workflows: WorkflowSyncResult | null;
  sessions: SessionSyncResult | null;
  skills: SkillSyncResults | null;
  tools: ToolSyncResults | null;
};

/** Syncs config, auth, MCP config, workflows, sessions, and every local skill and user tool with fl0w-work. */
export async function runFullSync(): Promise<FullSyncResult> {
  const empty: FullSyncResult = {
    skipped: null,
    config: null,
    workflows: null,
    sessions: null,
    skills: null,
    tools: null,
  };

  if (!(await readFl0wAuth())) return { ...empty, skipped: 'not-signed-in' };
  if (!(await isConfigSyncEnabled())) return { ...empty, skipped: 'sync-disabled' };

  const config = await syncConfigFiles();
  const workflows = await syncWorkflows();
  const sessions = await syncSessions();

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

  return { skipped: null, config, workflows, sessions, skills, tools };
}
