import { readdir } from 'node:fs/promises';
import { USER_TOOLS_DIR } from '../../constants';
import type { CapabilitySelection } from '../../models/agent';
import { authService } from '../auth/auth-service';
import { listRemoteTools, putToolBundle } from '../remote-api/sync-api';
import { MAX_SKILL_BUNDLE_BYTES, packFiles, type PackedSkill } from './sync-skills';
import { userToolLoader } from '../external-tools/user-tool-service';

const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

export type ToolSyncResult = 'unchanged' | 'pushed' | Error;
export type ToolSyncResults = Record<string, ToolSyncResult>;

class SyncToolService {
  private syncQueue: Promise<unknown> = Promise.resolve();

  async packUserTool(file: string, dir = USER_TOOLS_DIR): Promise<PackedSkill> {
    const helpers = (await this.listHelperFiles(dir)).filter((helper) => helper !== file);
    return packFiles(dir, [file, ...helpers].sort());
  }

  async syncEnabledTools(selection: CapabilitySelection): Promise<ToolSyncResults | null> {
    const run = this.syncQueue.then(async () => {
      const local = selection.userTools.flatMap((name) => {
        const file = userToolLoader.getUserToolSourceFile(name);
        return file ? [{ name, file }] : [];
      });
      if (local.length === 0) return {};
      if (!(await authService.readFl0wAuth())) return null;

      const remote = new Map((await listRemoteTools()).map((tool) => [tool.name, tool.contentHash]));
      const results: ToolSyncResults = {};

      for (const { name, file } of local) {
        try {
          const packed = await this.packUserTool(file);
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
    this.syncQueue = run.catch(() => { });
    return run;
  }

  async syncEnabledToolsInBackground(selection: CapabilitySelection): Promise<void> {
    try {
      const results = await this.syncEnabledTools(selection);
      for (const [name, result] of Object.entries(results ?? {})) {
        if (result instanceof Error) console.warn(`Failed to sync tool "${name}" to fl0w-work: ${result.message}`);
      }
    } catch (error) {
      console.warn(`Tool sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async listHelperFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('_') && !IGNORED_PATTERNS.some((p) => p.test(entry.name)))
      .map((entry) => entry.name);
  }
}

export const syncToolService = new SyncToolService();
