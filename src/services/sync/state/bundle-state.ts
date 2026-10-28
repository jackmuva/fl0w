import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BUNDLE_SYNC_STATE_PATH, FL0W_API_URL } from '../../../constants';
import type { BundleBase, BundleKind, BundleSyncState } from '../../../models/sync';
import { writeJsonAtomic } from '../../service-utils';

const asRecord = (value: unknown): Record<string, BundleBase> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, BundleBase> : {};

class BundleStateStore {
  private queue: Promise<unknown> = Promise.resolve();

  async read(userId: string, kind: BundleKind): Promise<Record<string, BundleBase>> {
    const state = await this.readFile();
    return this.isFor(state, userId) ? { ...state[kind] } : {};
  }

  async write(userId: string, kind: BundleKind, bases: Record<string, BundleBase>): Promise<void> {
    const run = this.queue.then(async () => {
      const stored = await this.readFile();
      const state: BundleSyncState = this.isFor(stored, userId) ? stored : { userId, apiUrl: FL0W_API_URL, skills: {}, tools: {} };
      state[kind] = bases;
      await mkdir(dirname(BUNDLE_SYNC_STATE_PATH), { recursive: true });
      await writeJsonAtomic(BUNDLE_SYNC_STATE_PATH, state);
    });
    this.queue = run.catch(() => { });
    return run;
  }

  private isFor(state: BundleSyncState, userId: string): boolean {
    return state.userId === userId && state.apiUrl === FL0W_API_URL;
  }

  private async readFile(): Promise<BundleSyncState> {
    const file = Bun.file(BUNDLE_SYNC_STATE_PATH);
    try {
      if (!(await file.exists())) return { skills: {}, tools: {} };
      const raw = await file.json() as Partial<BundleSyncState>;
      return {
        userId: typeof raw.userId === 'string' ? raw.userId : undefined,
        apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
        skills: asRecord(raw.skills),
        tools: asRecord(raw.tools),
      };
    } catch {
      return { skills: {}, tools: {} };
    }
  }
}

export const bundleStateStore = new BundleStateStore();
