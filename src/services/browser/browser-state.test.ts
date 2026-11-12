import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as constants from '../../constants';

// constants may already be loaded by other test files, so patch the module instead of setting FL0W_HOME. The patch
// outlives this file (other browser tests then share the profile), so it points outside the repo.
const home = mkdtempSync(join(tmpdir(), 'fl0w-browser-state-'));
mock.module('../../constants', () => ({
  ...constants,
  BROWSER_PROFILE_DIR: join(home, 'browser-profile'),
  BROWSER_STATE_PATH: join(home, 'browser-state.json'),
  BROWSER_STATE_APPLIED_PATH: join(home, 'browser-state.applied'),
}));
const { BROWSER_PROFILE_DIR, BROWSER_STATE_APPLIED_PATH, BROWSER_STATE_PATH } = await import('../../constants');
// these tests write the browser profile and its exported logins; never let them reach the real ~/.fl0w
if (![BROWSER_PROFILE_DIR, BROWSER_STATE_APPLIED_PATH, BROWSER_STATE_PATH].every((p) => p.startsWith(home))) throw new Error('browser-state test is not isolated');
const { exportBrowserState, parseBrowserState, toStoredCookies } = await import('./browser-state');
const { configSyncStore } = await import('../sync/config-sync');
const { closeBrowser, findChromeExecutable, openBrowser } = await import('./browser-session');

describe('toStoredCookies', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  test('drops expired cookies and read-only fields, keeps session cookies, and sorts', () => {
    const cookies = toStoredCookies([
      { name: 'b', value: '1', domain: 'b.test', path: '/', expires: now / 1000 + 60, size: 2, session: false },
      { name: 'old', value: '1', domain: 'a.test', path: '/', expires: now / 1000 - 60, session: false },
      { name: 'a', value: '1', domain: 'a.test', path: '/', expires: -1, session: true, httpOnly: true },
    ], now);
    expect(cookies).toEqual([
      { name: 'a', value: '1', domain: 'a.test', path: '/', httpOnly: true },
      { name: 'b', value: '1', domain: 'b.test', path: '/', expires: now / 1000 + 60 },
    ]);
  });
});

describe('parseBrowserState', () => {
  test('reads anything unusable as empty and ignores non-web origins', () => {
    expect(parseBrowserState(null)).toEqual({ version: 1, cookies: [], localStorage: {}, sessionStorage: {} });
    expect(parseBrowserState({
      cookies: 'x',
      localStorage: { 'chrome://x': { a: 'b' }, 'https://a.test': { k: 'v', n: 1 } },
      sessionStorage: { 'https://a.test': { s: 'v', n: 1 }, 'about:blank': { a: 'b' } },
    })).toEqual({ version: 1, cookies: [], localStorage: { 'https://a.test': { k: 'v' } }, sessionStorage: { 'https://a.test': { s: 'v' } } });
  });
});

describe('exportBrowserState', () => {
  const browser = {
    send: async <T>() => ({ cookies: [{ name: 'sid', value: 'v', domain: 'a.test', path: '/', session: true }] }) as T,
    waitForEvent: async () => true,
    onEvent: () => () => undefined,
  };
  const open = { localStorage: { 'https://a.test': { k: 'v' } }, sessionStorage: { 'https://a.test': { s: 'v' } } };

  test('push: false writes the file without queueing a push to fl0w-work', async () => {
    const notify = spyOn(configSyncStore, 'notifyLocalWrite').mockImplementation(() => undefined);
    try {
      expect(await exportBrowserState(browser, open, { push: false })).toBe(true);
      expect(notify).not.toHaveBeenCalled();
      expect(await readStateFile()).toEqual({ version: 1, cookies: [{ name: 'sid', value: 'v', domain: 'a.test', path: '/' }], ...open });
      // unchanged: nothing to push either way
      expect(await exportBrowserState(browser, open)).toBe(false);
      expect(notify).not.toHaveBeenCalled();
      await writeFile(BROWSER_STATE_PATH, '{}');
      expect(await exportBrowserState(browser, open)).toBe(true);
      expect(notify).toHaveBeenCalledWith(BROWSER_STATE_PATH);
    } finally {
      notify.mockRestore();
      // the Chrome tests below start from an empty state
      await rm(BROWSER_STATE_PATH, { force: true });
      await rm(BROWSER_STATE_APPLIED_PATH, { force: true });
    }
  });
});

const readStateFile = async () => parseBrowserState(await Bun.file(BROWSER_STATE_PATH).json());

describe.skipIf(!findChromeExecutable())('export and import (requires Chrome)', () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: () => new Response('<title>ok</title>', { headers: { 'content-type': 'text/html' } }) });
  });

  afterAll(async () => {
    await closeBrowser();
    server.stop(true);
    await rm(home, { recursive: true, force: true });
  });

  const origin = () => server.url.origin;
  const readState = async () => parseBrowserState(await Bun.file(BROWSER_STATE_PATH).json());
  const stateWith = (value: string) => ({
    version: 1,
    cookies: [{ name: 'sid', value, domain: '127.0.0.1', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 }],
    localStorage: { [origin()]: { k: value } },
    sessionStorage: { [origin()]: { s: value } },
  });
  const relaunch = async () => {
    await openBrowser({ headless: true, url: `${origin()}/` });
    await closeBrowser();
    return readState();
  };

  test('closing exports the profile; a file pulled from fl0w-work is loaded on the next launch', async () => {
    expect(await relaunch()).toEqual({ version: 1, cookies: [], localStorage: { [origin()]: {} }, sessionStorage: { [origin()]: {} } });
    expect(await Bun.file(BROWSER_STATE_APPLIED_PATH).exists()).toBe(true);

    // as if `fl0w sync` pulled a newer file
    await writeFile(BROWSER_STATE_PATH, JSON.stringify(stateWith('pulled')));
    const loaded = await relaunch();
    expect(loaded.cookies.map(({ name, value }) => [name, value])).toEqual([['sid', 'pulled']]);
    expect(loaded.localStorage[origin()]).toEqual({ k: 'pulled' });
    // exported from the page fl0w navigated to after launch, so the seeded sessionStorage survived into the site
    expect(loaded.sessionStorage[origin()]).toEqual({ s: 'pulled' });
  }, 60_000);

  test('a file the profile already saw is not loaded again over its own cookies', async () => {
    const stale = JSON.stringify(stateWith('stale'));
    await writeFile(BROWSER_STATE_PATH, stale);
    await writeFile(BROWSER_STATE_APPLIED_PATH, `${new Bun.CryptoHasher('sha256').update(stale).digest('hex')}\n`);
    const kept = await relaunch();
    expect(kept.cookies.map(({ value }) => value)).toEqual(['pulled']);
    expect(kept.localStorage[origin()]).toEqual({ k: 'pulled' });
    // Chrome drops sessionStorage with the tab, so the file's copy is seeded even when the rest is skipped
    expect(kept.sessionStorage[origin()]).toEqual({ s: 'stale' });
  }, 60_000);
});
