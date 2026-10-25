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
    const base = { mcpServers: { a: { url: 'a' } } };
    const edited = { mcpServers: { a: { url: 'b' } } };
    expect(mergeConfig('mcp.json', { base, local: edited, remote: base, preferLocal: false })).toEqual(edited);
    expect(mergeConfig('mcp.json', { base, local: base, remote: edited, preferLocal: true })).toEqual(edited);
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

  test('keeps the local fl0w login and ignores the remote one', () => {
    const base = { fl0w: login('base', 1) };
    const local = { fl0w: login('local', 5_000) };
    const remote = { fl0w: login('remote', 9_000) };
    expect(mergeConfig('auth.json', { base, local, remote, preferLocal: false }).fl0w).toEqual(local.fl0w);
    expect(mergeConfig('auth.json', { base, local: {}, remote, preferLocal: false }).fl0w).toBeUndefined();
  });

  test('a changed fl0w login alone does not make local win', () => {
    const mcp = { linear: { tokens: { access_token: 't' } } };
    const merged = mergeConfig('auth.json', {
      base: { fl0w: login('a', 1) },
      local: { fl0w: login('b', 2) },
      remote: { mcp },
      preferLocal: true,
    });
    expect(merged).toEqual({ fl0w: login('b', 2), mcp });
  });
});

describe('shareable', () => {
  test('drops only each file\'s local-only keys', () => {
    expect(shareable('mcp.json', { mcpServers: {}, extra: true })).toEqual({ mcpServers: {}, extra: true });
    expect(shareable('auth.json', { fl0w: login('t', 1), mcp: {} })).toEqual({ mcp: {} });
  });

  test('treats null content as empty object', () => {
    expect(shareable('mcp.json', null as unknown as JsonObject)).toEqual({});
  });
});

describe('mergeConfig with null snapshots', () => {
  test('merges when base or remote is null', () => {
    expect(mergeConfig('mcp.json', {
      base: null,
      local: { mcpServers: { l: { url: 'l' } }, extra: 'd' },
      remote: { mcpServers: { r: { url: 'r' } } },
      preferLocal: true,
    })).toEqual({ mcpServers: { l: { url: 'l' } }, extra: 'd' });
    expect(mergeConfig('mcp.json', {
      base: {},
      local: { mcpServers: { l: { url: 'l' } } },
      remote: null,
      preferLocal: false,
    })).toEqual({ mcpServers: { l: { url: 'l' } } });
  });
});
