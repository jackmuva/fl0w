import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APP_CONFIG_PATH,
  applyModelConfig,
  DEFAULT_AGENT_MODE,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_DECISION_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_TOOL_OUTPUT_MAX_CHARS,
  FL0W_HOME,
  parseAgentMode,
  parseConfigString,
} from '../../constants';
import type { AppConfig } from '../../models/config';
import type { McpConfig } from '../../models/mcp';
import { asJsonObject } from '../../services/sync/merge';
import { writeJsonAtomic } from '../../services/utils';

export { APP_CONFIG_PATH };

const writeDefaultJsonIfMissing = async (path: string, content: unknown): Promise<void> => {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await Bun.write(path, `${JSON.stringify(content, null, 2)}\n`);
};

const defaultAppConfig = (): AppConfig => ({
  llmModel: DEFAULT_LLM_MODEL,
  decisionModel: DEFAULT_DECISION_MODEL,
  mode: DEFAULT_AGENT_MODE,
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  toolOutputMaxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
  sync: true,
});

/** Add missing scaffold keys without changing values the user already set. */
const ensureConfigDefaults = async (path: string): Promise<void> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  const config = asJsonObject(await file.json()) as AppConfig;
  const defaults = defaultAppConfig();
  const merged: AppConfig = {
    llmModel: config.llmModel ?? defaults.llmModel,
    decisionModel: config.decisionModel ?? defaults.decisionModel,
    mode: parseAgentMode(config.mode) ?? config.mode ?? defaults.mode,
    contextWindow: config.contextWindow ?? defaults.contextWindow,
    toolOutputMaxChars: config.toolOutputMaxChars ?? defaults.toolOutputMaxChars,
    sync: config.sync ?? defaults.sync,
  };
  await writeJsonAtomic(path, merged);
};

export async function loadAppConfig(path = APP_CONFIG_PATH): Promise<AppConfig> {
  const file = Bun.file(path);
  const config = await file.exists() ? asJsonObject(await file.json()) as AppConfig : {};
  const llmModel = parseConfigString(config.llmModel);
  if (llmModel) process.env.LLM_MODEL = llmModel;
  const decisionModel = parseConfigString(config.decisionModel);
  if (decisionModel) process.env.DECISION_MODEL = decisionModel;
  const mode = parseAgentMode(config.mode);
  if (mode) process.env.AGENT_MODE = mode;
  if (config.contextWindow != null && config.contextWindow > 0) {
    process.env.CONTEXT_WINDOW = String(Math.floor(config.contextWindow));
  }
  if (config.toolOutputMaxChars != null && config.toolOutputMaxChars > 0) {
    process.env.TOOL_OUTPUT_MAX_CHARS = String(Math.floor(config.toolOutputMaxChars));
  }
  applyModelConfig();
  return config;
}

export async function isConfigSyncEnabled(path = APP_CONFIG_PATH): Promise<boolean> {
  try {
    return (asJsonObject(await Bun.file(path).json()) as AppConfig).sync !== false;
  } catch {
    return true;
  }
}

export async function ensureFl0wHome(home = FL0W_HOME): Promise<void> {
  mkdirSync(home, { recursive: true });
  await mkdir(join(home, 'tools'), { recursive: true });
  await mkdir(join(home, 'skills'), { recursive: true });
  await mkdir(join(home, 'workspace'), { recursive: true });

  const configPath = join(home, 'config.json');
  await writeDefaultJsonIfMissing(configPath, defaultAppConfig());
  await ensureConfigDefaults(configPath);
  await writeDefaultJsonIfMissing(join(home, 'mcp.json'), { mcpServers: {} } satisfies McpConfig);
}
