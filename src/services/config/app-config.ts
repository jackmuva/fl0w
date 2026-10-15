import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AI_GATEWAY_API_KEY_PLACEHOLDER,
  APP_CONFIG_PATH,
  applyModelConfig,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_DECISION_MODEL,
  DEFAULT_LLM_MODEL,
  FL0W_HOME,
  parseConfigString,
} from '../../constants';
import type { AppConfig } from '../../models/config';
import type { McpConfig } from '../../models/mcp';
import { notifyLocalWrite } from '../../services/sync/local-writes';
import { asJsonObject } from '../../services/sync/merge';
import { writeJsonAtomic } from '../../services/utils';

export { APP_CONFIG_PATH };

const writeDefaultJsonIfMissing = async (path: string, content: unknown): Promise<void> => {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await Bun.write(path, `${JSON.stringify(content, null, 2)}\n`);
};

const defaultAppConfig = (): AppConfig => ({
  aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
  llmModel: DEFAULT_LLM_MODEL,
  decisionModel: DEFAULT_DECISION_MODEL,
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  sync: true,
});

/** Add missing scaffold keys without changing values the user already set. */
const ensureConfigDefaults = async (path: string): Promise<void> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  const config = asJsonObject(await file.json()) as AppConfig;
  const defaults = defaultAppConfig();
  const merged: AppConfig = {
    aiGatewayApiKey: config.aiGatewayApiKey ?? defaults.aiGatewayApiKey,
    llmModel: config.llmModel ?? defaults.llmModel,
    decisionModel: config.decisionModel ?? defaults.decisionModel,
    contextWindow: config.contextWindow ?? defaults.contextWindow,
    sync: config.sync ?? defaults.sync,
  };
  if (
    merged.aiGatewayApiKey === config.aiGatewayApiKey
    && merged.llmModel === config.llmModel
    && merged.decisionModel === config.decisionModel
    && merged.contextWindow === config.contextWindow
    && merged.sync === config.sync
  ) return;
  await writeJsonAtomic(path, merged);
};

export async function loadAppConfig(path = APP_CONFIG_PATH): Promise<AppConfig> {
  const file = Bun.file(path);
  const config = await file.exists() ? asJsonObject(await file.json()) as AppConfig : {};
  if (
    config.aiGatewayApiKey
    && config.aiGatewayApiKey !== AI_GATEWAY_API_KEY_PLACEHOLDER
  ) {
    process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey;
  }
  const llmModel = parseConfigString(config.llmModel);
  if (llmModel) process.env.LLM_MODEL = llmModel;
  const decisionModel = parseConfigString(config.decisionModel);
  if (decisionModel) process.env.DECISION_MODEL = decisionModel;
  if (config.contextWindow != null && config.contextWindow > 0) {
    process.env.CONTEXT_WINDOW = String(Math.floor(config.contextWindow));
  }
  applyModelConfig();
  return config;
}

/** `sync: false` in config.json turns off config sync on this device; missing or unreadable config means on. */
export async function isConfigSyncEnabled(path = APP_CONFIG_PATH): Promise<boolean> {
  try {
    return (asJsonObject(await Bun.file(path).json()) as AppConfig).sync !== false;
  } catch {
    return true;
  }
}

export async function saveFl0wGatewayKey(key: string, path = APP_CONFIG_PATH): Promise<boolean> {
  const file = Bun.file(path);
  const config = await file.exists() ? asJsonObject(await file.json()) as AppConfig : {};
  const configKey = config.aiGatewayApiKey === AI_GATEWAY_API_KEY_PLACEHOLDER ? undefined : config.aiGatewayApiKey;
  const current = configKey ?? process.env.AI_GATEWAY_API_KEY;
  if (current && current !== key) return false;
  await writeJsonAtomic(path, { ...config, aiGatewayApiKey: key });
  notifyLocalWrite(path);
  process.env.AI_GATEWAY_API_KEY = key;
  return true;
}

export async function ensureFl0wHome(home = FL0W_HOME): Promise<void> {
  mkdirSync(home, { recursive: true });
  await mkdir(join(home, 'tools'), { recursive: true });
  await mkdir(join(home, 'skills'), { recursive: true });

  const configPath = join(home, 'config.json');
  await writeDefaultJsonIfMissing(configPath, defaultAppConfig());
  await ensureConfigDefaults(configPath);
  await writeDefaultJsonIfMissing(join(home, 'mcp.json'), { mcpServers: {} } satisfies McpConfig);
}
