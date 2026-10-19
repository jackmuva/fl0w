import type { CapabilitySelection, Fl0wMessage } from './agent';

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

/** Server-side metadata for one workflow (GET /api/sync/workflows). */
export type RemoteWorkflowMeta = {
  id: string;
  updatedAt: string;
};

/** Server-side metadata for one session (GET /api/sync/sessions). */
export type RemoteSessionMeta = {
  id: string;
  updatedAt: string;
};

/** A session row plus its messages in order, as GET/PUT /api/sync/sessions/:id carry it. */
export type RemoteSession = RemoteSessionMeta & {
  workspacePath: string;
  title: string | null;
  capabilities: CapabilitySelection | null;
  createdAt: string;
  messages: Fl0wMessage[];
};

/** Server-side metadata for one synced skill bundle (GET /api/sync/skills). */
export type RemoteSkillMeta = {
  name: string;
  contentHash: string;
  size: number;
  updatedAt: string;
};

/** Shape of ~/.fl0w/sync-state.json. */
export type SyncState = {
  /** fl0w user the state was synced for; a different signed-in user starts fresh. */
  userId?: string;
  files: Partial<Record<SyncFilename, {
    version: number;
    updatedAt: string;
    /** Content both sides agreed on at `version`; tells which side changed since. */
    base: JsonObject;
  }>>;
};
