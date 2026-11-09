import { readFile, writeFile } from 'node:fs/promises';
import { BROWSER_STATE_APPLIED_PATH, BROWSER_STATE_PATH } from '../../constants';
import { writeJsonAtomic } from '../service-utils';
import { configSyncStore } from '../sync/config-sync';
import { jsonEqual } from '../sync/merge/config-merge';

/**
 * Logins move between machines as plain cookies and localStorage, not profile files: Chrome encrypts the profile's
 * cookies with an OS key (the macOS Keychain), so a copied profile can't be read on another machine or in the sandbox.
 */

/** The subset of the CDP `Storage.getCookies` cookie that `Storage.setCookies` accepts back. */
export type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since the epoch; absent for session cookies. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: unknown;
};

export type BrowserState = {
  version: 1;
  cookies: BrowserCookie[];
  /** Origin -> localStorage entries. */
  localStorage: Record<string, Record<string, string>>;
};

/** The CdpConnection methods this module needs. */
export type Cdp = {
  send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  waitForEvent: (method: string, timeoutMs: number) => Promise<boolean>;
  onEvent: (listener: (method: string, params: Record<string, unknown>) => void) => () => void;
};

const COOKIE_FIELDS = ['name', 'value', 'domain', 'path', 'httpOnly', 'secure', 'sameSite', 'priority', 'sourceScheme', 'sourcePort', 'partitionKey'] as const;
const SEED_LOAD_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWebOrigin = (origin: string) => /^https?:\/\/[^/]+$/.test(origin);

/** Drops expired cookies and CDP's read-only fields; sorts so an unchanged jar compares equal. */
export function toStoredCookies(cookies: Record<string, unknown>[], now = Date.now()): BrowserCookie[] {
  return cookies
    .filter((cookie) => typeof cookie.name === 'string' && typeof cookie.value === 'string' && typeof cookie.domain === 'string')
    .filter((cookie) => cookie.session === true || typeof cookie.expires !== 'number' || cookie.expires <= 0 || cookie.expires * 1000 > now)
    .map((cookie) => {
      const stored = Object.fromEntries(COOKIE_FIELDS.filter((field) => cookie[field] !== undefined).map((field) => [field, cookie[field]]));
      if (cookie.session !== true && typeof cookie.expires === 'number' && cookie.expires > 0) stored.expires = cookie.expires;
      return { path: '/', ...stored } as BrowserCookie;
    })
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
}

/** Parses browser-state.json leniently; anything unusable reads as empty. */
export function parseBrowserState(raw: unknown): BrowserState {
  const value = isRecord(raw) ? raw : {};
  const cookies = Array.isArray(value.cookies) ? toStoredCookies(value.cookies.filter(isRecord)) : [];
  const localStorage: BrowserState['localStorage'] = {};
  for (const [origin, items] of Object.entries(isRecord(value.localStorage) ? value.localStorage : {})) {
    if (!isWebOrigin(origin) || !isRecord(items)) continue;
    localStorage[origin] = Object.fromEntries(Object.entries(items).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
  return { version: 1, cookies, localStorage };
}

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

const readStateText = () => readFile(BROWSER_STATE_PATH, 'utf8').catch(() => null);

const parseJson = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

const readAppliedHash = () => readFile(BROWSER_STATE_APPLIED_PATH, 'utf8').then((text) => text.trim(), () => null);

const writeAppliedHash = (text: string) => writeFile(BROWSER_STATE_APPLIED_PATH, `${sha256(text)}\n`, { mode: 0o600 });

/**
 * Writes the profile's cookies and the localStorage of `openOrigins` to browser-state.json and queues a push to
 * fl0w-work. Origins not open now keep their last exported entries. Returns whether the file changed.
 */
export async function exportBrowserState(browser: Cdp, openOrigins: Record<string, Record<string, string>>): Promise<boolean> {
  const { cookies } = await browser.send<{ cookies: Record<string, unknown>[] }>('Storage.getCookies');
  const text = await readStateText();
  const previous = parseBrowserState(parseJson(text));
  const next: BrowserState = {
    version: 1,
    cookies: toStoredCookies(cookies),
    localStorage: { ...previous.localStorage, ...Object.fromEntries(Object.entries(openOrigins).filter(([origin]) => isWebOrigin(origin))) },
  };
  if (text && jsonEqual(next, parseJson(text))) {
    await writeAppliedHash(text);
    return false;
  }
  await writeJsonAtomic(BROWSER_STATE_PATH, next);
  await writeAppliedHash((await readStateText()) ?? '');
  configSyncStore.notifyLocalWrite(BROWSER_STATE_PATH);
  return true;
}

/**
 * Loads browser-state.json into a freshly launched profile when it changed since the profile last saw it (e.g. it was
 * pulled from fl0w-work). An unchanged file is skipped so it can't overwrite newer cookies the profile kept on its own.
 * `page` must be a blank tab; it is used to seed localStorage and left on about:blank.
 */
export async function importBrowserState(browser: Cdp, page: Cdp | undefined): Promise<boolean> {
  const text = await readStateText();
  if (!text || sha256(text) === await readAppliedHash()) return false;
  const state = parseBrowserState(parseJson(text));
  await setCookies(browser, state.cookies);
  if (page) await seedLocalStorage(page, state.localStorage);
  await writeAppliedHash(text);
  return true;
}

async function setCookies(browser: Cdp, cookies: BrowserCookie[]): Promise<void> {
  if (cookies.length === 0) return;
  try {
    await browser.send('Storage.setCookies', { cookies });
  } catch {
    // one cookie Chrome rejects fails the whole batch; keep the rest
    for (const cookie of cookies) await browser.send('Storage.setCookies', { cookies: [cookie] }).catch(() => undefined);
  }
}

/**
 * Chrome only writes localStorage from a frame of that origin, so each origin is loaded in `page` with the request
 * answered locally by an empty page (nothing goes over the network) and its entries are set from there.
 */
async function seedLocalStorage(page: Cdp, localStorage: BrowserState['localStorage']): Promise<void> {
  const origins = Object.entries(localStorage).filter(([origin, items]) => isWebOrigin(origin) && Object.keys(items).length > 0);
  if (origins.length === 0) return;
  const stopListening = page.onEvent((method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    void page.send('Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'text/html' }],
      body: '',
    }).catch(() => undefined);
  });
  try {
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    for (const [origin, items] of origins) {
      try {
        const loaded = page.waitForEvent('Page.loadEventFired', SEED_LOAD_TIMEOUT_MS);
        await page.send('Page.navigate', { url: `${origin}/` });
        if (!(await loaded)) continue;
        await page.send('Runtime.evaluate', {
          expression: `for (const [k, v] of Object.entries(${JSON.stringify(items)})) localStorage.setItem(k, v)`,
        });
      } catch {
        // skip an origin Chrome won't load or store; the rest still seed
      }
    }
  } finally {
    await page.send('Fetch.disable').catch(() => undefined);
    stopListening();
    await page.send('Page.navigate', { url: 'about:blank' }).catch(() => undefined);
  }
}
