import { readdir } from 'node:fs/promises';
import { USER_TOOLS_DIR } from '../../../constants';
import type { CapabilitySelection } from '../../../models/agent';
import { readFl0wAuth } from '../../auth/token';
import { isConfigSyncEnabled } from '../../setup';
import { listRemoteTools, putToolBundle } from '../../remote-api/sync-api';
import { MAX_SKILL_BUNDLE_BYTES, packFiles, type PackedSkill } from '../../skills/sync-skills';
import { getUserToolSourceFile } from './loader';

// secrets that might sit next to the tools locally and must never leave the machine
const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

/**
 * Top-level `_`-prefixed files in USER_TOOLS_DIR. The loader skips them, so they're where shared helpers live; every
 * tool's bundle carries them so a tool's relative imports still resolve wherever it's extracted.
 */
async function listHelperFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('_') && !IGNORED_PATTERNS.some((p) => p.test(entry.name)))
    .map((entry) => entry.name);
}

export async function packUserTool(file: string, dir = USER_TOOLS_DIR): Promise<PackedSkill> {
  const helpers = (await listHelperFiles(dir)).filter((helper) => helper !== file);
  return packFiles(dir, [file, ...helpers].sort());
}

export type ToolSyncResult = 'unchanged' | 'pushed' | Error;
export type ToolSyncResults = Record<string, ToolSyncResult>;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Uploads enabled user tools from ~/.fl0w/tools to fl0w-work so remote workflow runs can pull them. Keyed by the
 * tool's exported name, which is what workflows store. Only bundles whose content hash differs from the server's are
 * sent. Expects loadUserTools to have run. Returns null when not signed in or `sync: false` is set in config.json.
 */
export async function syncEnabledTools(selection: CapabilitySelection): Promise<ToolSyncResults | null> {
  const run = queue.then(async () => {
    const local = selection.userTools.flatMap((name) => {
      const file = getUserToolSourceFile(name);
      return file ? [{ name, file }] : [];
    });
    if (local.length === 0) return {};
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const remote = new Map((await listRemoteTools()).map((tool) => [tool.name, tool.contentHash]));
    const results: ToolSyncResults = {};

    for (const { name, file } of local) {
      try {
        const packed = await packUserTool(file);
        if (remote.get(name) === packed.contentHash) {
          results[name] = 'unchanged';
          continue;
        }
        if (packed.bundle.byteLength > MAX_SKILL_BUNDLE_BYTES) {
          throw new Error(`Tool "${name}" is ${packed.bundle.byteLength} bytes compressed; the sync limit is ${MAX_SKILL_BUNDLE_BYTES}`);
        }
        await putToolBundle(name, packed.contentHash, packed.bundle);
        results[name] = 'pushed';
      } catch (error) {
        results[name] = error instanceof Error ? error : new Error(String(error));
      }
    }
    return results;
  });
  queue = run.catch(() => { });
  return run;
}

/** Background sync; failures are logged and retried the next time capabilities are applied. */
export async function syncEnabledToolsInBackground(selection: CapabilitySelection): Promise<void> {
  try {
    const results = await syncEnabledTools(selection);
    for (const [name, result] of Object.entries(results ?? {})) {
      if (result instanceof Error) console.warn(`Failed to sync tool "${name}" to fl0w-work: ${result.message}`);
    }
  } catch (error) {
    console.warn(`Tool sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
