import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AI_GATEWAY_API_KEY_PLACEHOLDER,
  APP_CONFIG_PATH,
  DEFAULT_LLM_MODEL,
  FL0W_HOME,
} from '../../constants';
import type { AppConfig } from '../../models/config';
import type { McpConfig } from '../../models/mcp';
import { notifyLocalWrite } from '../../services/sync/local-writes';
import { writeJsonAtomic } from '../../services/utils';

export { APP_CONFIG_PATH };

const writeDefaultJsonIfMissing = async (path: string, content: unknown): Promise<void> => {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await Bun.write(path, `${JSON.stringify(content, null, 2)}\n`);
};

export async function loadAppConfig(path = APP_CONFIG_PATH): Promise<AppConfig> {
  const file = Bun.file(path);
  const config = await file.exists() ? await file.json() as AppConfig : {};
  if (
    config.aiGatewayApiKey
    && config.aiGatewayApiKey !== AI_GATEWAY_API_KEY_PLACEHOLDER
  ) {
    process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey;
  }
  if (config.llmModel) {
    process.env.LLM_MODEL = config.llmModel;
  }
  return config;
}

/** `sync: false` in config.json turns off config sync on this device; missing or unreadable config means on. */
export async function isConfigSyncEnabled(path = APP_CONFIG_PATH): Promise<boolean> {
  try {
    return (await Bun.file(path).json() as AppConfig).sync !== false;
  } catch {
    return true;
  }
}

export async function saveFl0wGatewayKey(key: string, path = APP_CONFIG_PATH): Promise<boolean> {
  const file = Bun.file(path);
  const config = await file.exists() ? await file.json() as AppConfig : {};
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

  const defaultConfig: AppConfig = {
    aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
    llmModel: DEFAULT_LLM_MODEL,
    sync: true,
  };
  const defaultMcpConfig: McpConfig = { mcpServers: {} };

  await writeDefaultJsonIfMissing(join(home, 'config.json'), defaultConfig);
  await writeDefaultJsonIfMissing(join(home, 'mcp.json'), defaultMcpConfig);
}
