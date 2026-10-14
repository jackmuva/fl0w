import { SYNC_STATE_PATH } from '../../constants';
import type { SyncState } from '../../models/sync';
import { writeJsonAtomic } from '../utils';

export async function readSyncState(path = SYNC_STATE_PATH): Promise<SyncState> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { files: {} };
  try {
    return await file.json() as SyncState;
  } catch {
    // a lost merge base only means the next sync treats both sides as new
    return { files: {} };
  }
}

/** 0600: `base` snapshots include auth.json's tokens. */
export const writeSyncState = (state: SyncState, path = SYNC_STATE_PATH) => writeJsonAtomic(path, state);
