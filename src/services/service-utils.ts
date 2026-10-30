import Bottleneck from "bottleneck";
import { chmod, rename, writeFile } from "node:fs/promises";
import { resolve } from 'node:path';
import { SUBAGENT_TYPES, type ModelSelection } from '../models/agent';
import type { SessionRecord } from '../models/session';

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
    models: emptyModelSelection(),
    capabilities: null,
    createdAt: now,
    updatedAt: now,
  };
};
