import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentMode } from './models/config';

export const FL0W_HOME = process.env.FL0W_HOME ?? join(homedir(), '.fl0w');

export const HEADLESS_COMMANDS = ["workflow", "capabilities", "session"];

export const HEADLESS = HEADLESS_COMMANDS.includes(Bun.argv[2] ?? "");

export const ACCOUNT_COMMANDS = ["login", "logout", "whoami"]

export const APP_CONFIG_PATH = join(FL0W_HOME, 'config.json');

export const MCP_CONFIG_PATH = join(FL0W_HOME, 'mcp.json');

/** Headless runs give up on an MCP server that hasn't initialized by then, e.g. one waiting on a browser sign-in. */
export const HEADLESS_MCP_CONNECT_TIMEOUT_MS = 5_000;

export const USER_TOOLS_DIR = join(FL0W_HOME, 'tools');

export const FL0W_SKILLS_DIR = join(FL0W_HOME, 'skills');

export const DEFAULT_CONTEXT_WINDOW = 232_000;

const parseContextWindow = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
};

export const parseConfigString = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

export let CONTEXT_WINDOW = parseContextWindow(process.env.CONTEXT_WINDOW) ?? DEFAULT_CONTEXT_WINDOW;

export const COMPACTION_TOKEN_THRESHOLD = 0.75;

export const TOOL_TOKEN_THRESHOLD = 0.25;

/** Max MCP tools passed to decision routing after LLM tool selection. */
export const MAX_ROUTED_TOOL_OPTIONS = 10;

/** TypeSafe Choice allows at most 255 options; action select adds a few meta actions. */
export const MAX_EVALUATE_TOOL_OPTIONS = 250;

export const MAX_ITERATIONS = 50;

export const TOOL_TRUNCATE_STEPS = [12_000, 8_000, 4_000, 2_000, 800, 400];

export const TOOL_RESULT_MIN_KEEP = 120;

export const DEFAULT_DECISION_MODEL = 'typesafe-ai/jev';

export const DEFAULT_LLM_MODEL = 'zai/glm-5.3';

export let LLM_MODEL = parseConfigString(process.env.LLM_MODEL) ?? DEFAULT_LLM_MODEL;

export let DECISION_MODEL = parseConfigString(process.env.DECISION_MODEL) ?? DEFAULT_DECISION_MODEL;

export const DEFAULT_AGENT_MODE: AgentMode = 'decision';

export const parseAgentMode = (raw: string | undefined): AgentMode | undefined => {
  const value = parseConfigString(raw);
  if (value === 'decision' || value === 'llm') return value;
  return undefined;
};

export let AGENT_MODE = parseAgentMode(process.env.AGENT_MODE) ?? DEFAULT_AGENT_MODE;

export const applyModelConfig = (): void => {
  LLM_MODEL = parseConfigString(process.env.LLM_MODEL) ?? DEFAULT_LLM_MODEL;
  DECISION_MODEL = parseConfigString(process.env.DECISION_MODEL) ?? DEFAULT_DECISION_MODEL;
  AGENT_MODE = parseAgentMode(process.env.AGENT_MODE) ?? DEFAULT_AGENT_MODE;
  CONTEXT_WINDOW = parseContextWindow(process.env.CONTEXT_WINDOW) ?? DEFAULT_CONTEXT_WINDOW;
};

export const USER_TOOL_SERVER = 'user';

export const DB_PATH = join(FL0W_HOME, 'fl0w-sqlite.db');

export const FL0W_API_URL = (process.env.FL0W_API_URL ?? 'https://www.fl0w.work').replace(/\/+$/, '');

export const AUTH_PATH = join(FL0W_HOME, 'auth.json');

/** Per-file version + last-synced content for config sync with fl0w-work. */
export const SYNC_STATE_PATH = join(FL0W_HOME, 'sync-state.json');
