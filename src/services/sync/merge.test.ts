import { describe, expect, test } from 'bun:test';
import { jsonEqual, mergeConfig } from './merge';

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
  test('takes one-sided changes from each side', () => {
    const base = { llmModel: 'a', aiGatewayApiKey: 'k' };
    const merged = mergeConfig('config.json', {
      base,
      local: { ...base, llmModel: 'local-model' },
      remote: { ...base, aiGatewayApiKey: 'k2' },
      preferLocal: false,
    });
    expect(merged).toEqual({ llmModel: 'local-model', aiGatewayApiKey: 'k2' });
  });

  test('propagates deletions', () => {
    const base = { llmModel: 'a', extra: true };
    expect(mergeConfig('config.json', { base, local: { llmModel: 'a' }, remote: base, preferLocal: false }))
      .toEqual({ llmModel: 'a' });
    expect(mergeConfig('config.json', { base, local: base, remote: { llmModel: 'a' }, preferLocal: true }))
      .toEqual({ llmModel: 'a' });
  });

  test('resolves a two-sided conflict toward the newer side', () => {
    const args = { base: { llmModel: 'a' }, local: { llmModel: 'l' }, remote: { llmModel: 'r' } };
    expect(mergeConfig('config.json', { ...args, preferLocal: true })).toEqual({ llmModel: 'l' });
    expect(mergeConfig('config.json', { ...args, preferLocal: false })).toEqual({ llmModel: 'r' });
  });

  test('merges mcp.json servers and auth.json mcp entries per server', () => {
    const base = { mcpServers: { a: { url: 'a' } } };
    expect(mergeConfig('mcp.json', {
      base,
      local: { mcpServers: { a: { url: 'a' }, b: { url: 'b' } } },
      remote: { mcpServers: { a: { url: 'a2' }, c: { url: 'c' } } },
      preferLocal: true,
    })).toEqual({ mcpServers: { a: { url: 'a2' }, b: { url: 'b' }, c: { url: 'c' } } });

    const authBase = { mcp: { linear: { tokens: { access_token: 'old' } } } };
    expect(mergeConfig('auth.json', {
      base: authBase,
      local: { mcp: { ...authBase.mcp, notion: { tokens: { access_token: 'n' } } } },
      remote: { mcp: { linear: { tokens: { access_token: 'new' } } } },
      preferLocal: true,
    })).toEqual({ mcp: { linear: { tokens: { access_token: 'new' } }, notion: { tokens: { access_token: 'n' } } } });
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
