import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { preferencesStore } from './preferences-store';
import { createDraftSession } from '../services/service-utils';

const dir = join(import.meta.dir, '__fixtures__', 'preferences-store');
const path = join(dir, 'preferences.json');
const capabilities = { skills: ['s'], mcpServers: ['m'], userTools: [], agentsMd: [] };
const models = { ROUTER: 'r/router', PLAN: 'p/plan', EXECUTE: 'e/exec' };

beforeEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await preferencesStore.load(path);
});

describe('preferences store', () => {
  test('a missing file means no preferences', async () => {
    await preferencesStore.load(path);
    expect(preferencesStore.models()).toEqual({});
    expect(preferencesStore.capabilities()).toBeNull();
  });

  test('corrupt JSON means no preferences', async () => {
    await writeFile(path, '{not json');
    await preferencesStore.load(path);
    expect(preferencesStore.models()).toEqual({});
    expect(preferencesStore.capabilities()).toBeNull();
  });

  test('a bad field is dropped without losing the other', async () => {
    await writeFile(path, JSON.stringify({ models: { NOPE: 'x' }, capabilities }));
    await preferencesStore.load(path);
    expect(preferencesStore.models()).toEqual({});
    expect(preferencesStore.capabilities()).toEqual(capabilities);
  });

  test('save round-trips through the file', async () => {
    await preferencesStore.save({ models, capabilities }, path);
    await preferencesStore.load(join(dir, 'other.json'));
    expect(preferencesStore.capabilities()).toBeNull();
    await preferencesStore.load(path);
    expect(preferencesStore.models()).toEqual(models);
    expect(preferencesStore.capabilities()).toEqual(capabilities);
  });

  test('preferences() returns the whole validated file', async () => {
    await preferencesStore.load(path);
    expect(preferencesStore.preferences()).toEqual({});
    await preferencesStore.save({ models, capabilities }, path);
    await preferencesStore.load(path);
    expect(preferencesStore.preferences()).toEqual({ models, capabilities });
  });

  test('saving an unchanged choice does not rewrite the file', async () => {
    await writeFile(path, JSON.stringify({ capabilities, models: { EXECUTE: 'e/exec', PLAN: 'p/plan', ROUTER: 'r/router' } }));
    await preferencesStore.load(path);
    const before = (await stat(path)).mtimeMs;
    await Bun.sleep(5);
    await preferencesStore.save({ models, capabilities }, path);
    expect((await stat(path)).mtimeMs).toBe(before);
    await preferencesStore.save({ models: { ...models, PLAN: 'p/other' }, capabilities }, path);
    expect((await stat(path)).mtimeMs).not.toBe(before);
  });

  test('new draft sessions start from the preferred models but leave capabilities unset', async () => {
    await writeFile(path, JSON.stringify({ models: { PLAN: 'p/plan', EXECUTE: 'e/exec' }, capabilities }));
    await preferencesStore.load(path);
    const session = createDraftSession(dir);
    expect(session.models).toEqual({ ROUTER: '', PLAN: 'p/plan', EXECUTE: 'e/exec' });
    expect(session.capabilities).toBeNull();
  });
});
