import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { BROWSER_PROFILE_DIR } from '../../constants';
import type { BrowserFillField, BrowserTarget } from '../../models/browser';
import { pageScript } from './page-scripts';
import { readSecrets, resolveSecretRef } from '../secrets/secret-store';

const LAUNCH_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const SNAPSHOT_MAX_ELEMENTS = 300;
const SNAPSHOT_MAX_TEXT = 4_000;

const env = process.env;

export const findChromeExecutable = (): string | undefined => {
  if (env.FL0W_CHROME_PATH) return env.FL0W_CHROME_PATH;
  if (platform() === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')].find(existsSync);
  }
  if (platform() === 'win32') {
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter((dir): dir is string => !!dir)
      .map((dir) => join(dir, 'Google/Chrome/Application/chrome.exe'))
      .find(existsSync);
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const path = Bun.which(name);
    if (path) return path;
  }
  return undefined;
};

type CdpMessage = { id?: number, method?: string, params?: Record<string, unknown>, result?: unknown, error?: { message: string } };

class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>();
  private listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  closed = false;

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message.method, message.params ?? {});
      }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const waiter of this.pending.values()) waiter.reject(new Error('Browser tab connection closed'));
      this.pending.clear();
    });
  }

  static connect(url: string) {
    return new Promise<CdpConnection>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CdpConnection(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error(`Could not connect to Chrome at ${url}`)), { once: true });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new Error('Browser tab connection closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome did not answer ${method} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as T); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method: string, timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
      const listener = (name: string) => {
        if (name !== method) return;
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener); };
      this.listeners.add(listener);
    });
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}

type PageTarget = { id: string, type: string, url: string, title: string, webSocketDebuggerUrl?: string };

type BrowserState = {
  process: Subprocess,
  port: number,
  browserPath: string,
  headless: boolean,
  page?: { id: string, cdp: CdpConnection },
  knownTargets: Set<string>,
};

let state: BrowserState | undefined;
let exitHookInstalled = false;

const devtoolsFetch = async <T>(path: string, method = 'GET'): Promise<T> => {
  if (!state) throw new Error('Browser is not running');
  const response = await fetch(`http://127.0.0.1:${state.port}${path}`, { method });
  if (!response.ok) throw new Error(`Chrome DevTools ${path} failed: ${response.status}`);
  const text = await response.text();
  return (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T;
};

const listPages = async () => (await devtoolsFetch<PageTarget[]>('/json/list')).filter((t) => t.type === 'page');

const attachPage = async (target: PageTarget) => {
  if (!state) throw new Error('Browser is not running');
  if (!target.webSocketDebuggerUrl) throw new Error(`Tab ${target.id} is already controlled by another debugger`);
  state.page?.cdp.close();
  const cdp = await CdpConnection.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  state.page = { id: target.id, cdp };
  state.knownTargets.add(target.id);
  await devtoolsFetch(`/json/activate/${target.id}`).catch(() => undefined);
  return state.page;
};

/** Quits Chrome through CDP so it flushes cookies (logins) to disk; a signal would drop recent ones. */
export const closeBrowser = async () => {
  if (!state) return false;
  const { process: chrome, page, port, browserPath } = state;
  state = undefined;
  page?.cdp.close();
  try {
    const browser = await CdpConnection.connect(`ws://127.0.0.1:${port}${browserPath}`);
    await browser.send('Browser.close', {}, 3_000).catch(() => undefined);
    browser.close();
  } catch {
    // fall through to the kill below
  }
  if (!(await Promise.race([chrome.exited.then(() => true), Bun.sleep(5_000).then(() => false)]))) chrome.kill();
  return true;
};

const launchBrowser = async (headless: boolean) => {
  const executable = findChromeExecutable();
  if (!executable) throw new Error('Google Chrome was not found. Install Chrome or set FL0W_CHROME_PATH to its executable.');
  await mkdir(BROWSER_PROFILE_DIR, { recursive: true });
  const portFile = join(BROWSER_PROFILE_DIR, 'DevToolsActivePort');
  await rm(portFile, { force: true });

  const chrome = Bun.spawn([
    executable,
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=ProfilePicker',
    '--window-size=1280,900',
    ...(headless ? ['--headless=new'] : []),
    ...(platform() === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });

  let exited = false;
  void chrome.exited.then(() => {
    exited = true;
    if (state?.process === chrome) state = undefined;
  });

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let port: number | undefined;
  let browserPath = '';
  while (!port && Date.now() < deadline && !exited) {
    const [portLine, pathLine] = (await readFile(portFile, 'utf8').catch(() => '')).split('\n');
    port = Number(portLine) || undefined;
    browserPath = pathLine?.trim() ?? '';
    if (!port) await Bun.sleep(100);
  }
  if (!port) {
    chrome.kill();
    throw new Error(exited
      ? `Chrome exited during startup. The fl0w browser profile may already be open in another Chrome window; close it and retry.`
      : `Chrome did not start within ${LAUNCH_TIMEOUT_MS / 1000}s.`);
  }

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => state?.process.kill());
  }
  chrome.unref();
  state = { process: chrome, port, browserPath, headless, knownTargets: new Set() };
  const [first] = await listPages();
  if (first) await attachPage(first);
};

/** Ensures a browser and an attached tab exist, launching one if needed. */
const currentPage = async () => {
  if (!state) await launchBrowser(defaultHeadless());
  if (state?.page && !state.page.cdp.closed) return state.page.cdp;
  const pages = await listPages();
  const target = pages[0] ?? await devtoolsFetch<PageTarget>('/json/new?about:blank', 'PUT');
  return (await attachPage(target)).cdp;
};

const defaultHeadless = () =>
  env.FL0W_BROWSER_HEADLESS === '1' || (platform() === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);

type EvaluateResult = { result: { value?: unknown, objectId?: string }, exceptionDetails?: { exception?: { description?: string }, text: string } };

const evaluate = async <T>(body: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> => {
  const cdp = await currentPage();
  const response = await cdp.send<EvaluateResult>('Runtime.evaluate', {
    expression: pageScript(body),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error(description.split('\n')[0]?.replace(/^Error: /, '') ?? 'Page script failed');
  }
  return response.result.value as T;
};

/** Waits for any navigation triggered by an action to finish, then adopts a newly opened tab. */
const settle = async () => {
  await Bun.sleep(400);
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await evaluate<string>('return document.readyState;', 2_000).catch(() => 'loading');
    if (ready === 'complete') break;
    await Bun.sleep(250);
  }
  if (!state) return '';
  const fresh = (await listPages()).find((page) => !state?.knownTargets.has(page.id));
  if (!fresh) return '';
  await attachPage(fresh);
  return `Switched to the new tab that opened: ${fresh.url}\n`;
};

const target = (t: BrowserTarget) => JSON.stringify({ ref: t.ref, selector: t.selector, text: t.text });

export const openBrowser = async (options: { headless?: boolean, url?: string }) => {
  const headless = options.headless ?? defaultHeadless();
  if (state && state.headless !== headless) await closeBrowser();
  const launched = !state;
  if (!state) await launchBrowser(headless);
  const notes = [`${launched ? 'Launched' : 'Reusing'} Chrome${headless ? ', headless' : ''}.`];
  if (options.url) notes.push(await navigate({ url: options.url }));
  else notes.push(await snapshot());
  return notes.join('\n');
};

export const navigate = async ({ url, action }: { url?: string, action?: 'back' | 'forward' | 'reload' }) => {
  const cdp = await currentPage();
  if (url) {
    const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    const loaded = cdp.waitForEvent('Page.loadEventFired', NAVIGATION_TIMEOUT_MS);
    const result = await cdp.send<{ errorText?: string }>('Page.navigate', { url: full });
    if (result.errorText) throw new Error(`Navigation to ${full} failed: ${result.errorText}`);
    await loaded;
  } else if (action === 'reload') {
    const loaded = cdp.waitForEvent('Page.loadEventFired', NAVIGATION_TIMEOUT_MS);
    await cdp.send('Page.reload');
    await loaded;
  } else if (action) {
    const history = await cdp.send<{ currentIndex: number, entries: { id: number }[] }>('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)];
    if (!entry) throw new Error(`No page to go ${action} to`);
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  } else {
    throw new Error('Provide a url or an action (back, forward, reload)');
  }
  return (await settle()) + await snapshot();
};

export const snapshot = async (options: { waitForText?: string, timeoutMs?: number } = {}) => {
  if (options.waitForText) {
    const deadline = Date.now() + (options.timeoutMs ?? 10_000);
    const want = JSON.stringify(options.waitForText.toLowerCase());
    while (!(await evaluate<boolean>(`return (document.body?.innerText ?? '').toLowerCase().includes(${want});`).catch(() => false))) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for text "${options.waitForText}"`);
      await Bun.sleep(250);
    }
  }
  const tabs = state ? (await listPages()).length : 1;
  const snap = await evaluate<{ url: string, title: string, elements: string[], omitted: number, text: string }>(
    `return window.__fl0w.snapshot(${SNAPSHOT_MAX_ELEMENTS}, ${SNAPSHOT_MAX_TEXT});`,
  );
  return [
    `Page: ${snap.title || '(untitled)'} — ${snap.url}${tabs > 1 ? ` (${tabs} tabs open)` : ''}`,
    '',
    'Interactive elements (use the [ref] number with browser_click / browser_fill):',
    ...(snap.elements.length ? snap.elements : ['(none)']),
    ...(snap.omitted ? [`…${snap.omitted} more elements omitted; use a selector or text to target them.`] : []),
    '',
    'Page text:',
    snap.text || '(empty)',
  ].join('\n');
};

const clickAt = async (x: number, y: number) => {
  const cdp = await currentPage();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

export const click = async (t: BrowserTarget) => {
  const info = await evaluate<{ x: number, y: number, reachable: boolean, visible: boolean, description: string }>(`
    const el = window.__fl0w.resolve(${target(t)});
    window.__fl0wTarget = el;
    return { ...window.__fl0w.center(el), description: window.__fl0w.brief(el) };
  `);
  if (info.visible && info.reachable) await clickAt(info.x, info.y);
  else await evaluate('window.__fl0wTarget.click();');
  return `Clicked ${info.description}\n${await settle()}\n${await snapshot()}`;
};

const TRUTHY = new Set(['true', 'yes', 'on', 'checked', '1', 'y']);

const fillOne = async (field: BrowserFillField): Promise<string> => {
  const kind = await evaluate<{ kind: 'text' | 'native' | 'select' | 'toggle' | 'aria-toggle' | 'file', description: string, url: string }>(`
    const el = window.__fl0w.resolve(${target(field)});
    window.__fl0wTarget = el;
    window.__fl0w.center(el);
    const description = window.__fl0w.brief(el);
    const url = location.href;
    const type = el.tagName === 'INPUT' ? el.type : '';
    if (el.tagName === 'SELECT') return { kind: 'select', description, url };
    if (type === 'checkbox' || type === 'radio') return { kind: 'toggle', description, url };
    if (type === 'file') return { kind: 'file', description, url };
    if (['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range'].includes(type)) return { kind: 'native', description, url };
    if (el.hasAttribute('aria-checked')) return { kind: 'aria-toggle', description, url };
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (typeof el.select === 'function') {
      el.select();
    }
    return { kind: 'text', description, url };
  `);
  if (field.secret && !['text', 'native', 'select'].includes(kind.kind)) throw new Error(`Secrets can only fill text fields and selects, not ${kind.description}`);
  const value = field.secret ? resolveSecretRef(await readSecrets(), field.secret, kind.url) : field.value;
  if (value === undefined) throw new Error('Provide a value or a secret for each field');
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  const json = JSON.stringify(value);
  const cdp = await currentPage();

  switch (kind.kind) {
    case 'text': {
      if (text === '') await pressKey('Delete');
      else await cdp.send('Input.insertText', { text });
      const current = await evaluate<string>(`
        const el = window.__fl0wTarget;
        if (${JSON.stringify(text)} !== '' && !(el.isContentEditable ? el.innerText : el.value)) {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.isContentEditable ? el.innerText : el.value;
      `);
      if (field.secret) return `Filled ${kind.description} with secret ${field.secret}`;
      return `Filled ${kind.description} → "${kind.description.includes('input[password]') ? '••••' : current}"`;
    }
    case 'native':
      await evaluate(`
        const el = window.__fl0wTarget;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      `);
      return `Set ${kind.description} → ${field.secret ? `secret ${field.secret}` : `"${text}"`}`;
    case 'select': {
      const selected = await evaluate<string[]>(`
        const el = window.__fl0wTarget;
        const wanted = [].concat(${json}).map((v) => String(v).trim().toLowerCase());
        const options = [...el.options];
        const pick = (want) => options.find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
          ?? options.find((o) => o.text.toLowerCase().includes(want));
        const picks = wanted.map((want) => {
          const option = pick(want);
          if (!option) throw new Error('No option matching "' + want + '". Options: ' + options.map((o) => o.text.trim()).join(' | '));
          return option;
        });
        if (el.multiple) options.forEach((o) => { o.selected = picks.includes(o); });
        else el.value = picks[0].value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return options.filter((o) => o.selected).map((o) => o.text.trim());
      `);
      return `Selected "${selected.join(', ')}" in ${kind.description}`;
    }
    case 'toggle':
    case 'aria-toggle': {
      const want = typeof value === 'boolean' ? value : TRUTHY.has(text.trim().toLowerCase());
      const changed = await evaluate<{ x: number, y: number, reachable: boolean, visible: boolean } | null>(`
        const el = window.__fl0wTarget;
        const checked = ${kind.kind === 'toggle' ? 'el.checked' : "el.getAttribute('aria-checked') === 'true'"};
        if (checked === ${want}) return null;
        if (${kind.kind === 'toggle'}) { el.click(); return { x: 0, y: 0, reachable: false, visible: false }; }
        return window.__fl0w.center(el);
      `);
      if (changed?.reachable && changed.visible) await clickAt(changed.x, changed.y);
      else if (changed && kind.kind === 'aria-toggle') await evaluate('window.__fl0wTarget.click();');
      return `${changed ? (want ? 'Checked' : 'Unchecked') : `Left ${want ? 'checked' : 'unchecked'}`} ${kind.description}`;
    }
    case 'file': {
      const files = (Array.isArray(value) ? value : [text]).map((path) => resolve(String(path)));
      const missing = files.filter((path) => !existsSync(path));
      if (missing.length) throw new Error(`File not found: ${missing.join(', ')}`);
      const handle = await cdp.send<EvaluateResult>('Runtime.evaluate', { expression: 'window.__fl0wTarget' });
      await cdp.send('DOM.setFileInputFiles', { files, objectId: handle.result.objectId });
      return `Attached ${files.join(', ')} to ${kind.description}`;
    }
  }
};

export const fill = async (fields: BrowserFillField[]) => {
  const results: string[] = [];
  for (const field of fields) {
    try {
      results.push(await fillOne(field));
    } catch (error) {
      results.push(`Failed ${field.secret ? `${target(field)} (secret ${field.secret})` : target(field)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return results.join('\n');
};

const KEY_CODES: Record<string, [code: string, keyCode: number, text?: string]> = {
  Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Space: ['Space', 32, ' '],
};

const MODIFIERS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export const pressKey = async (combo: string, t?: BrowserTarget) => {
  if (t && (t.ref !== undefined || t.selector || t.text)) {
    await evaluate(`const el = window.__fl0w.resolve(${target(t)}); window.__fl0w.center(el); el.focus();`);
  }
  const parts = combo.split('+').map((part) => part.trim()).filter(Boolean);
  const keyName = parts.pop() ?? '';
  const modifiers = parts.reduce((mask, part) => {
    const bit = MODIFIERS[part.toLowerCase()];
    if (!bit) throw new Error(`Unknown modifier "${part}"`);
    return mask | bit;
  }, 0);
  const named = Object.entries(KEY_CODES).find(([name]) => name.toLowerCase() === keyName.toLowerCase());
  let key: string, code: string, keyCode: number, text: string | undefined;
  if (named) {
    key = named[0] === 'Space' ? ' ' : named[0];
    [code, keyCode, text] = named[1];
  } else if (keyName.length === 1) {
    key = keyName;
    code = /[a-z]/i.test(keyName) ? `Key${keyName.toUpperCase()}` : /\d/.test(keyName) ? `Digit${keyName}` : '';
    keyCode = keyName.toUpperCase().charCodeAt(0);
    text = keyName;
  } else {
    throw new Error(`Unknown key "${keyName}". Use a single character or one of: ${Object.keys(KEY_CODES).join(', ')}`);
  }
  if (modifiers & (2 | 4)) text = undefined;
  const cdp = await currentPage();
  const base = { key, code, windowsVirtualKeyCode: keyCode, modifiers };
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text });
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  return `Pressed ${combo}`;
};

export const pressKeyAndSettle = async (combo: string, t?: BrowserTarget) =>
  `${await pressKey(combo, t)}\n${await settle()}\n${await snapshot()}`;

export const screenshot = async (fullPage = false) => {
  const cdp = await currentPage();
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
  const dir = await mkdtemp(join(tmpdir(), 'fl0w-browser-'));
  const path = join(dir, 'screenshot.png');
  await writeFile(path, Buffer.from(data, 'base64'));
  const { size } = await stat(path);
  return `Screenshot saved (image/png, ${size} bytes)\n[image:${path}]`;
};
