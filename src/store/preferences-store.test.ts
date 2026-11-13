import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

  test('new draft sessions start from the preferred models but leave capabilities unset', async () => {
    await writeFile(path, JSON.stringify({ models: { PLAN: 'p/plan', EXECUTE: 'e/exec' }, capabilities }));
    await preferencesStore.load(path);
    const session = createDraftSession(dir);
    expect(session.models).toEqual({ ROUTER: '', PLAN: 'p/plan', EXECUTE: 'e/exec' });
    expect(session.capabilities).toBeNull();
  });
});
