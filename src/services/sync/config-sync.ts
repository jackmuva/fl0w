import { stat } from 'node:fs/promises';
import { AUTH_PATH, MCP_CONFIG_PATH } from '../../constants';
import type { AuthFile } from '../../models/auth';
import { SYNC_FILENAMES, type JsonObject, type RemoteFile, type RemoteFileMeta, type SyncFilename, type SyncState } from '../../models/sync';
import { authService } from '../auth/auth-service';
import { writeJsonAtomic } from '../service-utils';
import { asJsonObject, jsonEqual, mergeConfig, shareable } from './merge/config-merge';
import { getRemote, listRemote, putRemote, SyncConflictError } from '../remote-api/sync-api';
import { SYNC_STATE_PATH } from '../../constants';

const STARTUP_TIMEOUT_MS = 8_000;
const PUSH_DEBOUNCE_MS = 1_000;

const PATHS: Record<SyncFilename, string> = {
  get 'mcp.json'() { return MCP_CONFIG_PATH; },
  get 'auth.json'() { return AUTH_PATH; },
};

export type FileSyncResult = 'unchanged' | 'pulled' | 'pushed' | 'merged' | Error;
export type SyncResults = Partial<Record<SyncFilename, FileSyncResult>>;

type Listener = (path: string) => void;

class ConfigSyncStore {
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pendingPushes = new Map<SyncFilename, ReturnType<typeof setTimeout>>();

  private onLocalWrite(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyLocalWrite(path: string): void {
    for (const listener of this.listeners) listener(path);
  }

  private normalizeSyncState(raw: unknown): SyncState {
    const state = asJsonObject(raw);
    const files = state.files;
    return {
      userId: typeof state.userId === 'string' ? state.userId : undefined,
      files: files && typeof files === 'object' && !Array.isArray(files)
        ? files as SyncState['files']
        : {},
    };
  };

  private async readSyncState(path = SYNC_STATE_PATH): Promise<SyncState> {
    const file = Bun.file(path);
    if (!(await file.exists())) return { files: {} };
    try {
      return this.normalizeSyncState(await file.json());
    } catch {
      // a lost merge base only means the next sync treats both sides as new
      return { files: {} };
    }
  }

  /** 0600: `base` snapshots include auth.json's tokens. */
  private async writeSyncState(state: SyncState, path = SYNC_STATE_PATH): Promise<void> { await writeJsonAtomic(path, state); }

  /** Returns null when not signed in or `sync: false` is set in config.json. */
  async syncConfigFiles(filenames: readonly SyncFilename[] = SYNC_FILENAMES): Promise<SyncResults | null> {
    const run = this.queue.then(async () => {
      const auth = await authService.readFl0wAuth();
      if (!auth) return null;

      const stored = await this.readSyncState();
      const state: SyncState = stored.userId === auth.user.id ? stored : { userId: auth.user.id, files: {} };
      const metas = await listRemote();

      const results: SyncResults = {};
      for (const filename of filenames) {
        try {
          results[filename] = await this.syncFile(filename, state, metas.find((f) => f.filename === filename));
        } catch (error) {
          results[filename] = error instanceof Error ? error : new Error(String(error));
        }
      }
      await this.writeSyncState(state);
      return results;
    });
    this.queue = run.catch(() => { });
    return run;
  }

  async syncOnStartup(): Promise<string | null> {
    try {
      const results = await Promise.race([
        this.syncConfigFiles(),
        new Promise<'timeout'>((resolve) => setTimeout(resolve, STARTUP_TIMEOUT_MS, 'timeout').unref()),
      ]);
      if (results === 'timeout') return 'Config sync with fl0w-work timed out; continuing with local config.';
      const errors = Object.values(results ?? {}).filter((r): r is Error => r instanceof Error);
      return errors.length ? `Config sync: ${errors.map((e) => e.message).join('; ')}` : null;
    } catch (error) {
      return `Config sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  watchLocalConfigWrites(): () => void {
    return this.onLocalWrite((path) => {
      const filename = this.filenameForPath(path);
      if (!filename) return;
      clearTimeout(this.pendingPushes.get(filename));
      this.pendingPushes.set(filename, setTimeout(() => {
        this.pendingPushes.delete(filename);
        void this.push([filename]);
      }, PUSH_DEBOUNCE_MS));
    });
  }

  async flushPendingPushes(): Promise<void> {
    const filenames = [...this.pendingPushes.keys()];
    for (const timer of this.pendingPushes.values()) clearTimeout(timer);
    this.pendingPushes.clear();
    if (filenames.length) await this.push(filenames);
    await this.queue;
  }

  private async readLocal(path: string): Promise<JsonObject | undefined> {
    const file = Bun.file(path);
    if (!(await file.exists())) return undefined;
    try {
      return asJsonObject(await file.json());
    } catch {
      throw new Error(`${path} is not valid JSON; skipping sync for it`);
    }
  }

  private readonly mtimeMs = (path: string) => stat(path).then((s) => s.mtimeMs, () => 0);

  private async applyLocal(filename: SyncFilename, transform: (local: JsonObject | undefined) => JsonObject): Promise<JsonObject> {
    if (filename === 'auth.json') {
      return await authService.updateAuthFile((file: AuthFile) => {
        const next = transform(file as JsonObject);
        return jsonEqual(next, file) ? file : next as AuthFile;
      }, AUTH_PATH, { notify: false }) as JsonObject;
    }
    const local = await this.readLocal(PATHS[filename]);
    const next = transform(local);
    if (!local || !jsonEqual(next, local)) await writeJsonAtomic(PATHS[filename], next);
    return next;
  }

  private async syncFile(filename: SyncFilename, state: SyncState, meta: RemoteFileMeta | undefined, retried = false): Promise<FileSyncResult> {
    const path = PATHS[filename];
    const entry = state.files[filename];
    // an unchanged server version means its content is still our merge base; skip the download
    let remote: RemoteFile | null = !meta ? null
      : meta.version === entry?.version ? { ...meta, content: asJsonObject(entry?.base) }
        : await getRemote(filename);

    if (remote) remote = { ...remote, content: asJsonObject(remote.content) };

    if (!remote) {
      const local = await this.readLocal(path);
      if (!local) return 'unchanged';
      const content = shareable(filename, local);
      const created = await putRemote(filename, content, 0).catch((error) => {
        if (error instanceof SyncConflictError && !retried) return null;
        throw error;
      });
      // 409 on create means another device inserted it first; merge with theirs instead
      if (!created) return this.syncFile(filename, state, await this.findRemote(filename), true);
      state.files[filename] = { version: created.version, updatedAt: created.updatedAt, base: content };
      return 'pushed';
    }

    const preferLocal = entry ? (await this.mtimeMs(path)) >= Date.parse(remote.updatedAt) : false;
    let before: JsonObject | undefined;
    const merged = await this.applyLocal(filename, (local) => {
      before = local;
      return mergeConfig(filename, {
        base: entry?.base,
        local: local ?? asJsonObject(entry?.base),
        remote: remote.content,
        preferLocal,
      });
    });
    const changedLocally = !before || !jsonEqual(merged, before);
    const shared = shareable(filename, merged);

    if (jsonEqual(shared, remote.content)) {
      state.files[filename] = { version: remote.version, updatedAt: remote.updatedAt, base: shared };
      return changedLocally ? 'pulled' : 'unchanged';
    }

    try {
      const pushed = await putRemote(filename, shared, remote.version);
      state.files[filename] = { version: pushed.version, updatedAt: pushed.updatedAt, base: shared };
      return changedLocally ? 'merged' : 'pushed';
    } catch (error) {
      // another device pushed in between: merge again on top of its version, once
      if (error instanceof SyncConflictError && !retried) return this.syncFile(filename, state, await this.findRemote(filename), true);
      throw error;
    }
  }

  private readonly findRemote = async (filename: SyncFilename) => (await listRemote()).find((f) => f.filename === filename);

  private readonly filenameForPath = (path: string) =>
    (Object.entries(PATHS) as [SyncFilename, string][]).find(([, p]) => p === path)?.[0];

  private push(filenames: SyncFilename[]): Promise<SyncResults | null> {
    return this.syncConfigFiles(filenames).catch(() => null);
  }
}

export const configSyncStore = new ConfigSyncStore();
