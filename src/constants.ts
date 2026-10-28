import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelSelection } from './models/agent';

export const FL0W_HOME = join(homedir(), '.fl0w');

export const HEADLESS_COMMANDS = ["workflow", "capabilities", "session"];

export const HEADLESS = HEADLESS_COMMANDS.includes(Bun.argv[2] ?? "");

export const WORKFLOW_RUN = (Bun.argv[2] ?? "") === "workflow";

export const ACCOUNT_COMMANDS = ["login", "logout", "whoami"]

export const APP_CONFIG_PATH = join(FL0W_HOME, 'config.json');

export const MCP_CONFIG_PATH = join(FL0W_HOME, 'mcp.json');

export const HEADLESS_MCP_CONNECT_TIMEOUT_MS = 5_000;

export const USER_TOOLS_DIR = join(FL0W_HOME, 'tools');

export const FL0W_SKILLS_DIR = join(FL0W_HOME, 'skills');

export const WORKSPACE_DIR = join(FL0W_HOME, 'workspace');

export const sessionWorkspacePath = (sessionId: string): string => join(WORKSPACE_DIR, sessionId);

export const DEFAULT_MODELS: ModelSelection = {
  ROUTER: 'typesafe-ai/jev',
  DISCOVERY: 'deepseek/deepseek-v4.1-flash',
  PLAN: 'deepseek/deepseek-v4.1-flash',
  EXECUTE: 'deepseek/deepseek-v4.1-flash',
  SUMMARIZE: 'deepseek/deepseek-v4.1-flash',
};

export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 20_000;

export let TOOL_OUTPUT_MAX_CHARS = DEFAULT_TOOL_OUTPUT_MAX_CHARS;

export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

export const COMPACTION_TOKEN_THRESHOLD = 0.75;

export const TOOL_TOKEN_THRESHOLD = 0.25;

export const MAX_ROUTED_TOOL_OPTIONS = 20;

export const DEFAULT_MAX_ITERATIONS = 50;

export let MAX_ITERATIONS = DEFAULT_MAX_ITERATIONS;

export const PLAN_CHECK_MAX_RETRIES = 2;

export const TOOL_TRUNCATE_STEPS = [12_000, 8_000, 4_000, 2_000, 800, 400];

export const TOOL_RESULT_MIN_KEEP = 120;

export const USER_TOOL_SERVER = 'user';

export const OUTBOX_DIR = join(FL0W_HOME, 'outbox');

export const FL0W_API_URL = 'https://www.fl0w.work';

export const AUTH_PATH = join(FL0W_HOME, 'auth.json');

export const SYNC_STATE_PATH = join(FL0W_HOME, 'sync-state.json');

/** Merge bases for skill and tool bundles; kept apart from sync-state.json, which config sync rewrites on its own schedule. */
export const BUNDLE_SYNC_STATE_PATH = join(FL0W_HOME, 'bundle-sync-state.json');

/** Where a skill or tool file that lost a sync conflict is kept. */
export const SYNC_CONFLICTS_DIR = join(FL0W_HOME, 'sync-conflicts');
