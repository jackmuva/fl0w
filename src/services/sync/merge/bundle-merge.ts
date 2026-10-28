/** Path (relative to the bundle's directory) -> sha256 of the file's bytes. */
export type FileHashes = Record<string, string>;

export type FileConflict = { path: string; kept: 'local' | 'remote' };

export type FileMerge = {
  /** Paths to write from fl0w-work's copy. */
  take: string[];
  remove: string[];
  conflicts: FileConflict[];
};

export function mergeBundleFiles({ base, local, remote, localIsNewer }: {
  base?: FileHashes;
  local: FileHashes;
  remote: FileHashes;
  localIsNewer: (path: string) => boolean;
}): FileMerge {
  const merge: FileMerge = { take: [], remove: [], conflicts: [] };
  const paths = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)]);
  const takeRemote = (path: string) => (remote[path] === undefined ? merge.remove : merge.take).push(path);

  for (const path of [...paths].sort()) {
    const [b, l, r] = [base?.[path], local[path], remote[path]];
    if (l === r) continue;
    if (l === b) {
      takeRemote(path);
      continue;
    }
    if (r === b) continue;

    const kept = l !== undefined && localIsNewer(path) ? 'local' : 'remote';
    merge.conflicts.push({ path, kept });
    if (kept === 'remote') takeRemote(path);
  }
  return merge;
}
