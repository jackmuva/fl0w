import { describe, expect, test } from 'bun:test';
import type { JsonObject } from '../../models/sync';
import { jsonEqual, mergeConfig, shareable } from './merge';

const login = (accessToken: string, expiresAt: number) => ({
  accessToken, refreshToken: `${accessToken}-r`, expiresAt, user: { id: 'u1', email: 'a@b.c' },
});

describe('jsonEqual', () => {
  test('ignores key order and undefined values', () => {
    expect(jsonEqual({ a: 1, b: { c: 2, d: undefined } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe('mergeConfig', () => {
  test('takes the only side that changed, whichever is newer', () => {
    const base = { llmModel: 'a', extra: true };
    const edited = { llmModel: 'b' };
    expect(mergeConfig('config.json', { base, local: edited, remote: base, preferLocal: false })).toEqual(edited);
    expect(mergeConfig('config.json', { base, local: base, remote: edited, preferLocal: true })).toEqual(edited);
  });

  test('takes the newer file whole when both sides changed', () => {
    const args = {
      base: { mcpServers: { a: { url: 'a' } } },
      local: { mcpServers: { a: { url: 'a' }, b: { url: 'b' } } },
      remote: { mcpServers: { c: { url: 'c' } } },
    };
    expect(mergeConfig('mcp.json', { ...args, preferLocal: true })).toEqual(args.local);
    expect(mergeConfig('mcp.json', { ...args, preferLocal: false })).toEqual(args.remote);
  });

  test('keeps the longer-lived fl0w login regardless of which side is newer', () => {
    const base = { fl0w: login('base', 1) };
    const local = { fl0w: login('local', 5_000) };
    const remote = { fl0w: login('remote', 9_000) };
    expect(mergeConfig('auth.json', { base, local, remote, preferLocal: true }).fl0w).toEqual(remote.fl0w);
    expect(mergeConfig('auth.json', { base, local: remote, remote: local, preferLocal: false }).fl0w).toEqual(remote.fl0w);
  });

  test('never drops the local fl0w login', () => {
    const base = { fl0w: login('t', 1) };
    expect(mergeConfig('auth.json', { base, local: base, remote: {}, preferLocal: false })).toEqual(base);
  });
});

describe('shareable', () => {
  test('drops local-only keys from config.json only', () => {
    expect(shareable('config.json', { llmModel: 'm', sync: false })).toEqual({ llmModel: 'm' });
    expect(shareable('mcp.json', { sync: false })).toEqual({ sync: false });
  });

  test('treats null content as empty object', () => {
    expect(shareable('config.json', null as unknown as JsonObject)).toEqual({});
  });
});

describe('mergeConfig with null snapshots', () => {
  test('merges when base or remote is null', () => {
    expect(mergeConfig('config.json', {
      base: null,
      local: { llmModel: 'l', decisionModel: 'd' },
      remote: { llmModel: 'r' },
      preferLocal: true,
    })).toEqual({ llmModel: 'l', decisionModel: 'd' });
    expect(mergeConfig('config.json', {
      base: {},
      local: { llmModel: 'l' },
      remote: null,
      preferLocal: false,
    })).toEqual({ llmModel: 'l' });
  });
});
