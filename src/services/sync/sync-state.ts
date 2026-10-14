import { SYNC_STATE_PATH } from '../../constants';
import type { SyncState } from '../../models/sync';
import { writeJsonAtomic } from '../utils';
import { asJsonObject } from './merge';

const normalizeSyncState = (raw: unknown): SyncState => {
  const state = asJsonObject(raw);
  const files = state.files;
  return {
    userId: typeof state.userId === 'string' ? state.userId : undefined,
    files: files && typeof files === 'object' && !Array.isArray(files)
      ? files as SyncState['files']
      : {},
  };
};

export async function readSyncState(path = SYNC_STATE_PATH): Promise<SyncState> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { files: {} };
  try {
    return normalizeSyncState(await file.json());
  } catch {
    // a lost merge base only means the next sync treats both sides as new
    return { files: {} };
  }
}

/** 0600: `base` snapshots include auth.json's tokens. */
export const writeSyncState = (state: SyncState, path = SYNC_STATE_PATH) => writeJsonAtomic(path, state);
