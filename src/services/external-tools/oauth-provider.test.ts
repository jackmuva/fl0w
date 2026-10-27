import { afterAll, describe, expect, spyOn, test, mock } from 'bun:test';
import { join } from 'node:path';
import * as constants from '../../constants';

mock.module('../../constants', () => ({
  ...constants,
  HEADLESS: true,
  AUTH_PATH: join(import.meta.dir, '__fixtures__', 'oauth-provider', 'auth.json'),
}));

const { FileOAuthProvider } = await import('./oauth-provider');

const log = spyOn(console, 'log').mockImplementation(() => {});

afterAll(() => {
  log.mockRestore();
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
