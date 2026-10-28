import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as constants from '../../constants';

const home = join(import.meta.dir, '__fixtures__', 'full-sync');
mock.module('../../constants', () => ({
  ...constants,
  FL0W_API_URL: 'https://fl0w.test',
  FL0W_HOME: home,
  FL0W_SKILLS_DIR: join(home, 'skills'),
  USER_TOOLS_DIR: join(home, 'tools'),
  APP_CONFIG_PATH: join(home, 'config.json'),
  AUTH_PATH: join(home, 'auth.json'),
  MCP_CONFIG_PATH: join(home, 'mcp.json'),
  SYNC_STATE_PATH: join(home, 'sync-state.json'),
  OUTBOX_DIR: join(home, 'outbox'),
  BUNDLE_SYNC_STATE_PATH: join(home, 'bundle-sync-state.json'),
  SYNC_CONFLICTS_DIR: join(home, 'sync-conflicts'),
}));
const { AUTH_PATH } = await import('../../constants');
if (!AUTH_PATH.startsWith(home)) throw new Error('full-sync test is not isolated');
const { runFullSync } = await import('./full-sync');

beforeEach(async () => {
  await rm(home, { recursive: true, force: true });
  await mkdir(join(home, 'skills'), { recursive: true });
  await mkdir(join(home, 'tools'), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('runFullSync', () => {
  test('skips when not signed in', async () => {
    expect((await runFullSync()).skipped).toBe('not-signed-in');
  });

});
