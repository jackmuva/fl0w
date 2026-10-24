import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from './models/config';

const positiveConfigInt = (value: unknown): number | undefined => {
  const parsed = Math.floor(typeof value === 'string' && value.trim() ? Number(value) : value as number);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
};

export const parseConfigString = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

export const FL0W_HOME = join(homedir(), '.fl0w');

export const HEADLESS_COMMANDS = ["workflow", "capabilities", "session"];

export const HEADLESS = HEADLESS_COMMANDS.includes(Bun.argv[2] ?? "");

export const ACCOUNT_COMMANDS = ["login", "logout", "whoami"]

export const APP_CONFIG_PATH = join(FL0W_HOME, 'config.json');

export const MCP_CONFIG_PATH = join(FL0W_HOME, 'mcp.json');

/** Headless runs give up on an MCP server that hasn't initialized by then, e.g. one waiting on a browser sign-in. */
export const HEADLESS_MCP_CONNECT_TIMEOUT_MS = 5_000;

export const USER_TOOLS_DIR = join(FL0W_HOME, 'tools');

export const FL0W_SKILLS_DIR = join(FL0W_HOME, 'skills');

export const WORKSPACE_DIR = join(FL0W_HOME, 'workspace');

export const sessionWorkspacePath = (sessionId: string): string => join(WORKSPACE_DIR, sessionId);

export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 20_000;

export let TOOL_OUTPUT_MAX_CHARS = DEFAULT_TOOL_OUTPUT_MAX_CHARS;

export const COMPACTION_TOKEN_THRESHOLD = 0.75;

export const TOOL_TOKEN_THRESHOLD = 0.25;

export const MAX_ROUTED_TOOL_OPTIONS = 20;

export const DEFAULT_MAX_ITERATIONS = 50;

export let MAX_ITERATIONS = DEFAULT_MAX_ITERATIONS;

export const TOOL_TRUNCATE_STEPS = [12_000, 8_000, 4_000, 2_000, 800, 400];

export const TOOL_RESULT_MIN_KEEP = 120;

export const USER_TOOL_SERVER = 'user';

export const DB_PATH = join(FL0W_HOME, 'fl0w-sqlite.db');

export const FL0W_API_URL = 'https://www.fl0w.work';

export const AUTH_PATH = join(FL0W_HOME, 'auth.json');

export const SYNC_STATE_PATH = join(FL0W_HOME, 'sync-state.json');

export const applyAppConfig = (config: AppConfig): void => {
  TOOL_OUTPUT_MAX_CHARS = positiveConfigInt(config.toolOutputMaxChars) ?? DEFAULT_TOOL_OUTPUT_MAX_CHARS;
  MAX_ITERATIONS = positiveConfigInt(config.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
};
