import { afterAll, describe, expect, spyOn, test, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import * as constants from '../../constants';

const authDir = mkdtempSync(join(tmpdir(), 'fl0w-oauth-provider-'));

mock.module('../../constants', () => ({
  ...constants,
  HEADLESS: true,
  AUTH_PATH: join(authDir, 'auth.json'),
}));

const { FileOAuthProvider } = await import('./oauth-provider');
const { authService } = await import('../auth/auth-service');

const log = spyOn(console, 'log').mockImplementation(() => {});

afterAll(() => {
  log.mockRestore();
  rmSync(authDir, { recursive: true, force: true });
});

describe('FileOAuthProvider (headless)', () => {
  test('reports each server needing authorization once on stdout and still throws', async () => {
    const linear = new FileOAuthProvider('linear', 'https://mcp.linear.app/mcp');
    const authUrl = new URL('https://linear.app/oauth/authorize');

    await expect(linear.redirectToAuthorization(authUrl)).rejects.toThrow('needs authorization');
    await expect(linear.redirectToAuthorization(authUrl)).rejects.toThrow('needs authorization');
    await expect(new FileOAuthProvider('notion', 'https://mcp.notion.com/mcp').redirectToAuthorization(authUrl)).rejects.toThrow();

    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { type: 'mcp_auth_required', server: 'linear', serverUrl: 'https://mcp.linear.app/mcp' },
      { type: 'mcp_auth_required', server: 'notion', serverUrl: 'https://mcp.notion.com/mcp' },
    ]);
  });
});

describe('FileOAuthProvider (static endpoints)', () => {
  test('authorizes against the configured endpoints and client without discovery', async () => {
    const provider = new FileOAuthProvider('github', 'https://api.githubcopilot.com/mcp/', {
      clientId: 'static-client',
      clientSecret: 'shh',
      scope: 'repo',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    });
    const redirect = spyOn(provider, 'redirectToAuthorization').mockResolvedValue();
    const requested: string[] = [];
    const fetchFn = async (url: string | URL) => {
      requested.push(String(url));
      return new Response('not found', { status: 404 });
    };

    expect(await auth(provider, { serverUrl: 'https://api.githubcopilot.com/mcp/', fetchFn })).toBe('REDIRECT');

    const url = redirect.mock.calls[0]![0];
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('static-client');
    expect(url.searchParams.get('scope')).toBe('repo');
    // only the optional protected-resource lookup; no auth-server metadata or client registration
    expect(requested.every((u) => u.includes('oauth-protected-resource'))).toBe(true);
    expect((await authService.readAuthFile()).mcp?.github?.discoveryState).toBeUndefined();
  });

  test('falls back to discovery unless both endpoints are set', async () => {
    const provider = new FileOAuthProvider('partial', 'https://example.com/mcp', { authorizationUrl: 'https://example.com/authorize' });
    expect(await provider.discoveryState()).toBeUndefined();
  });
});
