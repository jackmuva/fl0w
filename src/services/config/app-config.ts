import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AI_GATEWAY_API_KEY_PLACEHOLDER,
  APP_CONFIG_PATH,
  DEFAULT_LLM_MODEL,
  JEV_HOME,
} from '../../constants';
import type { AppConfig } from '../../models/config';
import type { McpConfig } from '../../models/mcp';
import { installFl0wGateway } from '../auth/gateway-provider';
import { readFl0wAuth } from '../auth/token';

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
  // Without a user-supplied gateway key, route model calls through fl0w-work using `fl0w login` tokens.
  if (!process.env.AI_GATEWAY_API_KEY && await readFl0wAuth()) {
    installFl0wGateway();
  }
  return config;
}

export async function ensureJevHome(home = JEV_HOME): Promise<void> {
  mkdirSync(home, { recursive: true });
  await mkdir(join(home, 'tools'), { recursive: true });

  const defaultConfig: AppConfig = {
    aiGatewayApiKey: AI_GATEWAY_API_KEY_PLACEHOLDER,
    llmModel: DEFAULT_LLM_MODEL,
  };
  const defaultMcpConfig: McpConfig = { mcpServers: {} };

  await writeDefaultJsonIfMissing(join(home, 'config.json'), defaultConfig);
  await writeDefaultJsonIfMissing(join(home, 'mcp.json'), defaultMcpConfig);
}
