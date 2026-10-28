
export const SYNC_FILENAMES = ['mcp.json', 'auth.json'] as const;

export type SyncFilename = (typeof SYNC_FILENAMES)[number];

export type JsonObject = Record<string, unknown>;

/** Server-side metadata for one config file (GET /api/sync/config-files). */
export type RemoteFileMeta = {
  filename: SyncFilename;
  version: number;
  updatedAt: string;
};

export type RemoteFile = RemoteFileMeta & { content: JsonObject };

/** Server-side metadata for one synced skill bundle (GET /api/sync/skills). */
export type RemoteSkillMeta = {
  name: string;
  contentHash: string;
  size: number;
  updatedAt: string;
};

/** Server-side metadata for one synced user tool bundle (GET /api/sync/tools). */
export type RemoteToolMeta = RemoteSkillMeta;

export type SyncState = {
  userId?: string;
  files: Partial<Record<SyncFilename, {
    version: number;
    updatedAt: string;
    base: JsonObject;
  }>>;
};

export type BundleKind = 'skills' | 'tools';

/** A skill or tool bundle as of its last sync: the merge base for the next one. */
export type BundleBase = {
  contentHash: string;
  /** fl0w-work's `updatedAt` for that bundle. */
  updatedAt: string;
  /** Path (relative to `dir`) -> sha256 of each file in the bundle. */
  files: Record<string, string>;
  /** Directory the bundle lives in on this device. */
  dir: string;
  /** For a tool, its own file in `dir` (the rest are shared `_` helpers). */
  file?: string;
};

export type BundleSyncState = {
  userId?: string;
  /** fl0w-work deployment the bases came from; another one's bases would read as deletions. */
  apiUrl?: string;
  skills: Record<string, BundleBase>;
  tools: Record<string, BundleBase>;
};
