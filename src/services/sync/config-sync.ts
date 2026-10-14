import { stat } from 'node:fs/promises';
import { APP_CONFIG_PATH, AUTH_PATH, MCP_CONFIG_PATH } from '../../constants';
import type { AuthFile } from '../../models/auth';
import { SYNC_FILENAMES, type JsonObject, type RemoteFile, type RemoteFileMeta, type SyncFilename, type SyncState } from '../../models/sync';
import { updateAuthFile } from '../auth/auth-store';
import { isConfigSyncEnabled } from '../config/app-config';
import { readFl0wAuth } from '../auth/token';
import { writeJsonAtomic } from '../utils';
import { onLocalWrite } from './local-writes';
import { asJsonObject, jsonEqual, mergeConfig, shareable } from './merge';
import { getRemote, listRemote, putRemote, SyncConflictError } from './sync-api';
import { readSyncState, writeSyncState } from './sync-state';

const STARTUP_TIMEOUT_MS = 8_000;
const PUSH_DEBOUNCE_MS = 1_000;

const PATHS: Record<SyncFilename, string> = {
  'config.json': APP_CONFIG_PATH,
  'mcp.json': MCP_CONFIG_PATH,
  'auth.json': AUTH_PATH,
};

export type FileSyncResult = 'unchanged' | 'pulled' | 'pushed' | 'merged' | Error;
export type SyncResults = Partial<Record<SyncFilename, FileSyncResult>>;

/** Undefined when missing; throws on invalid JSON so a half-edited file is never overwritten. */
async function readLocal(path: string): Promise<JsonObject | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return asJsonObject(await file.json());
  } catch {
    throw new Error(`${path} is not valid JSON; skipping sync for it`);
  }
}

const mtimeMs = (path: string) => stat(path).then((s) => s.mtimeMs, () => 0);

/** Reads, transforms, and (if changed) writes a local file; auth.json goes through its write queue. */
async function applyLocal(filename: SyncFilename, transform: (local: JsonObject | undefined) => JsonObject): Promise<JsonObject> {
  if (filename === 'auth.json') {
    return await updateAuthFile((file) => {
      const next = transform(file as JsonObject);
      return jsonEqual(next, file) ? file : next as AuthFile;
    }, AUTH_PATH, { notify: false }) as JsonObject;
  }
  const local = await readLocal(PATHS[filename]);
  const next = transform(local);
  if (!local || !jsonEqual(next, local)) await writeJsonAtomic(PATHS[filename], next);
  return next;
}

async function syncFile(filename: SyncFilename, state: SyncState, meta: RemoteFileMeta | undefined, retried = false): Promise<FileSyncResult> {
  const path = PATHS[filename];
  const entry = state.files[filename];
  // an unchanged server version means its content is still our merge base; skip the download
  let remote: RemoteFile | null = !meta ? null
    : meta.version === entry?.version ? { ...meta, content: asJsonObject(entry?.base) }
      : await getRemote(filename);

  if (remote) remote = { ...remote, content: asJsonObject(remote.content) };

  if (!remote) {
    // nothing on the server yet (e.g. first sign-in): just insert this device's copy
    const local = await readLocal(path);
    if (!local) return 'unchanged';
    const content = shareable(filename, local);
    const created = await putRemote(filename, content, 0).catch((error) => {
      if (error instanceof SyncConflictError && !retried) return null;
      throw error;
    });
    // 409 on create means another device inserted it first; merge with theirs instead
    if (!created) return syncFile(filename, state, await findRemote(filename), true);
    state.files[filename] = { version: created.version, updatedAt: created.updatedAt, base: content };
    return 'pushed';
  }

  // with no merge base (first sync on this device/account) the server's established state wins conflicts
  const preferLocal = entry ? (await mtimeMs(path)) >= Date.parse(remote.updatedAt) : false;
  let before: JsonObject | undefined;
  const merged = await applyLocal(filename, (local) => {
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

  if (jsonEqual(shared, shareable(filename, remote.content))) {
    state.files[filename] = { version: remote.version, updatedAt: remote.updatedAt, base: shared };
    return changedLocally ? 'pulled' : 'unchanged';
  }

  try {
    const pushed = await putRemote(filename, shared, remote.version);
    state.files[filename] = { version: pushed.version, updatedAt: pushed.updatedAt, base: shared };
    return changedLocally ? 'merged' : 'pushed';
  } catch (error) {
    // another device pushed in between: merge again on top of its version, once
    if (error instanceof SyncConflictError && !retried) return syncFile(filename, state, await findRemote(filename), true);
    throw error;
  }
}

const findRemote = async (filename: SyncFilename) => (await listRemote()).find((f) => f.filename === filename);

let queue: Promise<unknown> = Promise.resolve();

/**
 * Reconciles local config files with fl0w-work: pulls server changes, pushes local ones, and
 * three-way merges when both moved. Returns null when not signed in or `sync: false` is set in config.json.
 */
export async function syncConfigFiles(filenames: readonly SyncFilename[] = SYNC_FILENAMES): Promise<SyncResults | null> {
  const run = queue.then(async () => {
    const auth = await readFl0wAuth();
    if (!auth || !(await isConfigSyncEnabled())) return null;

    const stored = await readSyncState();
    const state: SyncState = stored.userId === auth.user.id ? stored : { userId: auth.user.id, files: {} };
    const metas = await listRemote();

    const results: SyncResults = {};
    for (const filename of filenames) {
      try {
        results[filename] = await syncFile(filename, state, metas.find((f) => f.filename === filename));
      } catch (error) {
        results[filename] = error instanceof Error ? error : new Error(String(error));
      }
    }
    await writeSyncState(state);
    return results;
  });
  queue = run.catch(() => { });
  return run;
}

/** Startup sync: bounded and never throws, so a slow or offline fl0w-work can't block the CLI. Returns a warning, if any. */
export async function syncOnStartup(): Promise<string | null> {
  if (!(await isConfigSyncEnabled())) return null;
  try {
    const results = await Promise.race([
      syncConfigFiles(),
      new Promise<'timeout'>((resolve) => setTimeout(resolve, STARTUP_TIMEOUT_MS, 'timeout').unref()),
    ]);
    if (results === 'timeout') return 'Config sync with fl0w-work timed out; continuing with local config.';
    const errors = Object.values(results ?? {}).filter((r): r is Error => r instanceof Error);
    return errors.length ? `Config sync: ${errors.map((e) => e.message).join('; ')}` : null;
  } catch (error) {
    return `Config sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const pendingPushes = new Map<SyncFilename, ReturnType<typeof setTimeout>>();

const filenameForPath = (path: string) =>
  (Object.entries(PATHS) as [SyncFilename, string][]).find(([, p]) => p === path)?.[0];

// failures stay local until the next startup sync, which re-diffs against the merge base
const push = (filenames: SyncFilename[]) => syncConfigFiles(filenames).catch(() => null);

/** Pushes local config changes (token refreshes, `fl0w login`, etc.) shortly after they're written. */
export function watchLocalConfigWrites(): () => void {
  return onLocalWrite((path) => {
    const filename = filenameForPath(path);
    if (!filename) return;
    clearTimeout(pendingPushes.get(filename));
    pendingPushes.set(filename, setTimeout(() => {
      pendingPushes.delete(filename);
      void push([filename]);
    }, PUSH_DEBOUNCE_MS));
  });
}

/** Sends debounced pushes now and waits for in-flight syncs; call before a deliberate exit. */
export async function flushPendingPushes(): Promise<void> {
  const filenames = [...pendingPushes.keys()];
  for (const timer of pendingPushes.values()) clearTimeout(timer);
  pendingPushes.clear();
  if (filenames.length) await push(filenames);
  await queue;
}
