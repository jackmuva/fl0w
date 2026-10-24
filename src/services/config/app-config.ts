import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APP_CONFIG_PATH,
  applyAppConfig,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TOOL_OUTPUT_MAX_CHARS,
  FL0W_HOME,
} from '../../constants';
import type { AppConfig } from '../../models/config';
import type { McpConfig } from '../../models/mcp';
import { asJsonObject } from '../../services/sync/merge';
import { writeJsonAtomic } from '../../services/utils';

const writeDefaultJsonIfMissing = async (path: string, content: unknown): Promise<void> => {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await Bun.write(path, `${JSON.stringify(content, null, 2)}\n`);
};

const defaultAppConfig = (): AppConfig => ({
  toolOutputMaxChars: DEFAULT_TOOL_OUTPUT_MAX_CHARS,
  maxIterations: DEFAULT_MAX_ITERATIONS,
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
    contextWindow: config.contextWindow ?? defaults.contextWindow,
    toolOutputMaxChars: config.toolOutputMaxChars ?? defaults.toolOutputMaxChars,
    maxIterations: config.maxIterations ?? defaults.maxIterations,
    sync: config.sync ?? defaults.sync,
  };
  await writeJsonAtomic(path, merged);
};

export async function loadAppConfig(path = APP_CONFIG_PATH): Promise<AppConfig> {
  const file = Bun.file(path);
  const config = await file.exists() ? asJsonObject(await file.json()) as AppConfig : {};
  applyAppConfig(config);
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
