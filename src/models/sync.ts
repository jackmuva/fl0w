
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
