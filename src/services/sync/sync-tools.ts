import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { USER_TOOLS_DIR } from '../../constants';
import type { BundleBase } from '../../models/sync';
import { authService } from '../auth/auth-service';
import { deleteRemoteTool, getToolBundle, listRemoteTools, putToolBundle } from '../remote-api/sync-api';
import { bundleStateStore } from './state/bundle-state';
import { packFiles, syncBundle, type BundleSide, type BundleSyncResult, type LocalBundle, type PackedSkill } from './bundle-sync';
import { userToolLoader } from '../external-tools/user-tool-service';

const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

export type ToolSyncResult = BundleSyncResult;
export type ToolSyncResults = Record<string, ToolSyncResult>;

class SyncToolService {
  private syncQueue: Promise<unknown> = Promise.resolve();

  async packUserTool(file: string, dir = USER_TOOLS_DIR): Promise<PackedSkill> {
    return packFiles(dir, await this.toolFiles(file, dir));
  }

  /**
   * Syncs every loaded tool, every tool on fl0w-work, and every tool synced before, both ways. A tool's bundle carries
   * the shared `_` helpers, so a helper pulled with one tool is pushed with the others on the same run.
   */
  async syncAllTools(): Promise<ToolSyncResults | null> {
    const run = this.syncQueue.then(async () => {
      await userToolLoader.loadUserTools();
      const auth = await authService.readFl0wAuth();
      if (!auth) return null;

      const loaded = new Map(userToolLoader.listUserTools().flatMap(({ name }) => {
        const file = userToolLoader.getUserToolSourceFile(name);
        return file ? [[name, file] as const] : [];
      }));
      const remote = new Map((await listRemoteTools()).map((tool) => [tool.name, tool]));
      const bases = await bundleStateStore.read(auth.user.id, 'tools');
      const names = [...new Set([...loaded.keys(), ...remote.keys(), ...Object.keys(bases)])].sort();
      const results: ToolSyncResults = {};
      let changedLocally = false;

      for (const name of names) {
        try {
          const outcome = await syncBundle(this.side, name, this.locate(loaded.get(name), bases[name]), remote.get(name) ?? null, bases[name]);
          if (outcome.base) bases[name] = outcome.base;
          else delete bases[name];
          changedLocally ||= outcome.changedLocally !== null;
          results[name] = outcome.result;
        } catch (error) {
          results[name] = error instanceof Error ? error : new Error(String(error));
        }
      }
      await bundleStateStore.write(auth.user.id, 'tools', bases);
      // new tools load now; a changed tool already imported in this process takes effect on the next run
      if (changedLocally) {
        userToolLoader.reset();
        await userToolLoader.loadUserTools();
      }
      return results;
    });
    this.syncQueue = run.catch(() => { });
    return run;
  }

  async syncAllToolsInBackground(): Promise<void> {
    try {
      const results = await this.syncAllTools();
      for (const [name, result] of Object.entries(results ?? {})) {
        if (result instanceof Error) console.warn(`Failed to sync tool "${name}" with fl0w-work: ${result.message}`);
      }
    } catch (error) {
      console.warn(`Tool sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private readonly side: BundleSide = {
    kind: 'tools',
    label: 'Tool',
    get: getToolBundle,
    put: putToolBundle,
    remove: deleteRemoteTool,
    place: (name, files) => {
      const file = files.find((path) => !path.startsWith('_'));
      if (!file) throw new Error(`Tool "${name}" on fl0w-work has no tool file`);
      return this.localTool(file);
    },
    // the `_` helpers are shared with other tools, so only the tool's own file goes
    removeLocal: async (local) => {
      if (local.file) await rm(join(local.dir, local.file), { force: true });
    },
  };

  private localTool(file: string, dir = USER_TOOLS_DIR): LocalBundle {
    return {
      dir,
      file,
      listFiles: async () => (await Bun.file(join(dir, file)).exists()) ? this.toolFiles(file, dir) : null,
    };
  }

  /** A tool that fails to load still counts as present while its file (as of the last sync) is there. */
  private locate(loadedFile: string | undefined, base: BundleBase | undefined): LocalBundle | null {
    const file = loadedFile ?? base?.file;
    return file ? this.localTool(file) : null;
  }

  private async toolFiles(file: string, dir: string): Promise<string[]> {
    const helpers = (await this.listHelperFiles(dir)).filter((helper) => helper !== file);
    return [file, ...helpers].sort();
  }

  private async listHelperFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('_') && !IGNORED_PATTERNS.some((p) => p.test(entry.name)))
      .map((entry) => entry.name);
  }
}

export const syncToolService = new SyncToolService();
