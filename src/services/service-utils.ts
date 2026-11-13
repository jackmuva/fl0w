import Bottleneck from "bottleneck";
import { chmod, rename, writeFile } from "node:fs/promises";
import { resolve } from 'node:path';
import { SUBAGENT_TYPES, type CapabilityKind, type CapabilitySelection, type ModelSelection, type SubagentType } from '../models/agent';
import type { SessionRecord } from '../models/session';
import { preferencesStore } from '../store/preferences-store';

export const modelRateLimiter = new Bottleneck({
  minTime: 100,
  maxConcurrent: 5,
  highWater: 1_000,
  strategy: Bottleneck.strategy.LEAK,
});

export async function retryModelCall<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  if (attempts < 1) throw new Error("scheduleLlmTask: attempts must be >= 1");

  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await modelRateLimiter.schedule(fn);
    } catch (err) {
      lastError = err;
      const isLastAttempt = i === attempts - 1;
      if (isLastAttempt) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw lastError;
}

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // no browser available; callers also print the URL
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export const emptyModelSelection = (): ModelSelection =>
  Object.fromEntries(SUBAGENT_TYPES.map((type) => [type, ''])) as ModelSelection;

export const createDraftSession = (workspacePath: string, id: string = crypto.randomUUID()): SessionRecord => {
  const now = (new Date()).toISOString();
  return {
    id,
    workspacePath: resolve(workspacePath),
    title: null,
    // capabilities stay null so the TUI still opens /configure (preselected from preferences) for a new session
    models: { ...emptyModelSelection(), ...preferencesStore.models() },
    capabilities: null,
    createdAt: now,
    updatedAt: now,
  };
};

const CAPABILITY_KINDS: CapabilityKind[] = ['skills', 'mcpServers', 'userTools', 'agentsMd'];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `{ "<phase>": "<model>" }` with known phases only; null when the shape is wrong. */
export const parseModelSelection = (value: unknown): Partial<ModelSelection> | null => {
  if (!isPlainObject(value)) return null;
  const models: Partial<ModelSelection> = {};
  for (const [phase, model] of Object.entries(value)) {
    if (!SUBAGENT_TYPES.includes(phase as SubagentType) || typeof model !== 'string') return null;
    models[phase as SubagentType] = model;
  }
  return models;
};

/** A CapabilitySelection with string arrays for every kind; null when the shape is wrong. */
export const parseCapabilitySelection = (value: unknown): CapabilitySelection | null => {
  if (!isPlainObject(value)) return null;
  for (const kind of CAPABILITY_KINDS) {
    const list = value[kind];
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) return null;
  }
  return {
    skills: value.skills as string[],
    mcpServers: value.mcpServers as string[],
    userTools: value.userTools as string[],
    agentsMd: value.agentsMd as string[],
  };
};
