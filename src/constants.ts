import { homedir } from 'node:os';
import { join } from 'node:path';

export const JEV_HOME = process.env.FL0W_HOME ?? join(homedir(), '.fl0w');

export const HEADLESS = Bun.argv[2] === 'run';

export const APP_CONFIG_PATH = join(JEV_HOME, 'config.json');

export const MCP_CONFIG_PATH = join(JEV_HOME, 'mcp.json');

/** Pre-auth.json location of per-server MCP OAuth files; read once and migrated into auth.json. */
export const LEGACY_MCP_AUTH_DIR = join(JEV_HOME, 'mcp-auth');

export const USER_TOOLS_DIR = join(JEV_HOME, 'tools');

export const COMPACTION_CONTEXT_WINDOW = 32_000;

export const COMPACTION_TOKEN_THRESHOLD = 0.75;

export const TOOL_TRUNCATE_STEPS = [12_000, 8_000, 4_000, 2_000, 800, 400];

export const TOOL_RESULT_MIN_KEEP = 120;

export const SYSTEM_ONE_MODEL = 'typesafe-ai/jev';

export const DEFAULT_LLM_MODEL = 'deepseek/deepseek-v4-flash';

export const AI_GATEWAY_API_KEY_PLACEHOLDER = 'YOUR_VERCEL_AI_GATEWAY_API_KEY';

export const LLM_MODEL = process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;

export const USER_TOOL_SERVER = 'user';

export const DB_PATH = join(JEV_HOME, 'fl0w-sqlite.db');

export const FL0W_API_URL = (process.env.FL0W_API_URL ?? 'https://fl0w.work').replace(/\/+$/, '');

/** fl0w login tokens and MCP OAuth state. */
export const AUTH_PATH = join(JEV_HOME, 'auth.json');
