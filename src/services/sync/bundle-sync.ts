import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { SYNC_CONFLICTS_DIR } from '../../constants';
import type { BundleBase, BundleKind, RemoteSkillMeta } from '../../models/sync';
import { BundleConflictError, type RemoteBundle } from '../remote-api/sync-api';
import { mergeBundleFiles, type FileHashes } from './merge/bundle-merge';

/** Matches fl0w-work's limit, which sits under Vercel's 4.5 MB request body cap. */
export const MAX_SKILL_BUNDLE_BYTES = 4 * 1024 * 1024;

export type PackedSkill = {
  /** sha256 over sorted paths + file bytes; stable across runs, unlike the tarball (which embeds mtimes). */
  contentHash: string;
  bundle: Uint8Array<ArrayBuffer>;
  files: string[];
  fileHashes: FileHashes;
};

export type BundleSyncResult = 'unchanged' | 'pulled' | 'pushed' | 'merged' | 'deleted' | Error;

export type LocalBundle = {
  dir: string;
  /** For a tool, its own file in `dir`. */
  file?: string;
  listFiles: () => Promise<string[] | null>;
};

/** What differs between syncing skills and syncing tools. */
export type BundleSide = {
  kind: BundleKind;
  label: 'Skill' | 'Tool';
  get: (name: string) => Promise<RemoteBundle | null>;
  put: (name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>, baseHash: string | null) => Promise<RemoteSkillMeta>;
  remove: (name: string) => Promise<void>;
  /** Where a bundle that is only on fl0w-work goes, given its files. */
  place: (name: string, files: string[]) => LocalBundle;
  removeLocal: (local: LocalBundle, files: string[]) => Promise<void>;
};

export type BundleOutcome = {
  result: Exclude<BundleSyncResult, Error>;
  /** The merge base for the next sync; null once the bundle is gone from both sides. */
  base: BundleBase | null;
  /** Where the bundle now lives, when this sync wrote to or deleted from it. */
  changedLocally: LocalBundle | null;
};

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

export async function packFiles(dir: string, files: string[]): Promise<PackedSkill> {
  const contents: Record<string, Uint8Array> = {};
  const fileHashes: FileHashes = {};
  const hasher = new Bun.CryptoHasher('sha256');
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(dir, file)));
    contents[file] = bytes;
    fileHashes[file] = sha256(bytes);
    hasher.update(`${file}\0${fileHashes[file]}\n`);
  }
  const bundle = await new Bun.Archive(contents, { compress: 'gzip' }).bytes();
  return { contentHash: hasher.digest('hex'), bundle, files, fileHashes };
}

export async function unpackBundle(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const [path, file] of await new Bun.Archive(bytes).files()) {
    if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error(`bundle has an unsafe path: ${path}`);
    files.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}

class RetrySync extends Error {
  constructor(readonly current: RemoteSkillMeta | null, readonly base: BundleBase | undefined) {
    super('retry');
  }
}

export async function syncBundle(
  side: BundleSide,
  name: string,
  local: LocalBundle | null,
  remote: RemoteSkillMeta | null,
  base: BundleBase | undefined,
): Promise<BundleOutcome> {
  try {
    return await syncOnce(side, name, local, remote, base, false);
  } catch (error) {
    if (!(error instanceof RetrySync)) throw error;
    const outcome = await syncOnce(side, name, local, error.current, error.base, true);
    return { ...outcome, changedLocally: outcome.changedLocally ?? local };
  }
}

async function syncOnce(
  side: BundleSide,
  name: string,
  local: LocalBundle | null,
  remote: RemoteSkillMeta | null,
  base: BundleBase | undefined,
  retried: boolean,
): Promise<BundleOutcome> {
  const files = local ? await local.listFiles() : null;
  const packed = local && files ? await packFiles(local.dir, files) : null;

  const baseFor = (at: LocalBundle, contentHash: string, updatedAt: string, fileHashes: FileHashes): BundleBase => ({
    contentHash,
    updatedAt,
    files: fileHashes,
    dir: at.dir,
    ...(at.file && { file: at.file }),
  });

  const push = async (at: LocalBundle, bundle: PackedSkill, mergedWith: BundleBase | undefined): Promise<BundleBase> => {
    if (bundle.bundle.byteLength > MAX_SKILL_BUNDLE_BYTES) {
      throw new Error(`${side.label} "${name}" is ${bundle.bundle.byteLength} bytes compressed; the sync limit is ${MAX_SKILL_BUNDLE_BYTES}`);
    }
    try {
      const meta = await side.put(name, bundle.contentHash, bundle.bundle, mergedWith?.contentHash ?? null);
      return baseFor(at, meta.contentHash, meta.updatedAt, bundle.fileHashes);
    } catch (error) {
      if (error instanceof BundleConflictError && !retried) throw new RetrySync(error.current, mergedWith);
      throw error;
    }
  };

  if (!packed && !remote) return { result: 'unchanged', base: null, changedLocally: null };
  if (packed && remote?.contentHash === packed.contentHash) {
    return { result: 'unchanged', base: baseFor(local!, remote.contentHash, remote.updatedAt, packed.fileHashes), changedLocally: null };
  }

  if (!packed) {
    if (base && remote!.contentHash === base.contentHash) {
      await side.remove(name);
      return { result: 'deleted', base: null, changedLocally: null };
    }
    // new on fl0w-work, or changed there since this device deleted it
    const fetched = await side.get(name);
    if (!fetched) return { result: 'unchanged', base: null, changedLocally: null };
    const remoteFiles = await unpackBundle(fetched.bytes);
    const at = local ?? side.place(name, [...remoteFiles.keys()]);
    await writeBundleFiles(at.dir, remoteFiles, [...remoteFiles.keys()]);
    const pulled = await packFiles(at.dir, [...remoteFiles.keys()].sort());
    return { result: 'pulled', base: baseFor(at, fetched.contentHash, remote!.updatedAt, pulled.fileHashes), changedLocally: at };
  }

  if (!remote) {
    if (base && packed.contentHash === base.contentHash) {
      const backup = await backUpFiles(side, name, local!.dir, packed.files);
      console.warn(`${side.label} "${name}" was deleted on fl0w-work, so it was deleted here; a copy is at ${backup}`);
      await side.removeLocal(local!, Object.keys(base.files));
      return { result: 'deleted', base: null, changedLocally: local };
    }
    // new on this device, or changed here since fl0w-work deleted it
    return { result: 'pushed', base: await push(local!, packed, undefined), changedLocally: null };
  }

  if (base && remote.contentHash === base.contentHash) {
    return { result: 'pushed', base: await push(local!, packed, base), changedLocally: null };
  }

  const fetched = await side.get(name);
  if (!fetched) return syncOnce(side, name, local, null, base, retried);
  const remoteFiles = await unpackBundle(fetched.bytes);
  const remoteHashes: FileHashes = Object.fromEntries([...remoteFiles].map(([path, bytes]) => [path, sha256(bytes)]));
  const remoteTime = Date.parse(remote.updatedAt);
  const localTimes = new Map<string, number>();
  for (const file of packed.files) localTimes.set(file, (await stat(join(local!.dir, file))).mtimeMs);

  const merge = mergeBundleFiles({
    base: base?.files,
    local: packed.fileHashes,
    remote: remoteHashes,
    localIsNewer: (path) => (localTimes.get(path) ?? -Infinity) >= remoteTime,
  });
  await backUpConflicts(side, name, local!.dir, merge.conflicts, remoteFiles);
  await writeBundleFiles(local!.dir, remoteFiles, merge.take);
  await removeBundleFiles(local!.dir, merge.remove);

  const wrote = merge.take.length + merge.remove.length > 0;
  const mergedWith = baseFor(local!, fetched.contentHash, remote.updatedAt, remoteHashes);
  const merged = await packFiles(local!.dir, (await local!.listFiles()) ?? []);
  if (merged.contentHash === fetched.contentHash) {
    return { result: 'pulled', base: { ...mergedWith, files: merged.fileHashes }, changedLocally: local };
  }
  return { result: wrote ? 'merged' : 'pushed', base: await push(local!, merged, mergedWith), changedLocally: wrote ? local : null };
}

async function writeBundleFiles(dir: string, files: Map<string, Uint8Array>, paths: string[]): Promise<void> {
  for (const path of paths) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, files.get(path)!);
  }
}

export async function removeBundleFiles(dir: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    await rm(join(dir, path), { force: true });
    for (let parent = dirname(path); parent !== '.' && parent !== '/'; parent = dirname(parent)) {
      try {
        await rmdir(join(dir, parent));
      } catch {
        break;
      }
    }
  }
}

const backupDirFor = (side: BundleSide, name: string) =>
  join(SYNC_CONFLICTS_DIR, side.kind, name, new Date().toISOString().replace(/[:.]/g, '-'));

/** Copies `paths` of a bundle about to be deleted here under ~/.fl0w/sync-conflicts; returns where. */
async function backUpFiles(side: BundleSide, name: string, dir: string, paths: string[]): Promise<string> {
  const backupDir = backupDirFor(side, name);
  for (const path of paths) {
    await mkdir(dirname(join(backupDir, path)), { recursive: true });
    await writeFile(join(backupDir, path), await readFile(join(dir, path)));
  }
  return backupDir;
}

async function backUpConflicts(
  side: BundleSide,
  name: string,
  dir: string,
  conflicts: ReturnType<typeof mergeBundleFiles>['conflicts'],
  remoteFiles: Map<string, Uint8Array>,
): Promise<void> {
  if (conflicts.length === 0) return;
  const backupDir = backupDirFor(side, name);
  for (const { path, kept } of conflicts) {
    const lost = kept === 'remote'
      ? await readFile(join(dir, path)).then((bytes) => new Uint8Array(bytes), () => undefined)
      : remoteFiles.get(path);
    const keptFrom = kept === 'local' ? 'this device' : 'fl0w-work';
    if (!lost) {
      console.warn(`${side.label} "${name}": ${path} changed on both sides; kept the copy from ${keptFrom}`);
      continue;
    }
    const target = join(backupDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, lost);
    console.warn(`${side.label} "${name}": ${path} changed on both sides; kept the copy from ${keptFrom}, the other is at ${target}`);
  }
}
