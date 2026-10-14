export const SYNC_FILENAMES = ['config.json', 'mcp.json', 'auth.json'] as const;

export type SyncFilename = (typeof SYNC_FILENAMES)[number];

export type JsonObject = Record<string, unknown>;

/** Server-side metadata for one config file (GET /api/sync/config-files). */
export type RemoteFileMeta = {
  filename: SyncFilename;
  version: number;
  updatedAt: string;
};

export type RemoteFile = RemoteFileMeta & { content: JsonObject };

/** Shape of ~/.fl0w/sync-state.json. */
export type SyncState = {
  /** fl0w user the state was synced for; a different signed-in user starts fresh. */
  userId?: string;
  files: Partial<Record<SyncFilename, {
    version: number;
    updatedAt: string;
    /** Content both sides agreed on at `version`; the base for three-way merges. */
    base: JsonObject;
  }>>;
};
