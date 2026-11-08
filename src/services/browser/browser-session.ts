import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSERBASE_API_URL, BROWSER_LOG_LIMIT, BROWSER_SNAPSHOT_MAX_CHARS } from '../../constants';
import { CdpConnection, type CdpEvent } from './cdp';

export type BrowserConnection = {
  connectUrl: string;
  liveViewUrl?: string;
  release?: () => Promise<void>;
};

export type BrowserConnector = () => Promise<BrowserConnection>;

type TargetInfo = { targetId: string; type: string; title: string; url: string };
type AxValue = { value?: unknown };
type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: { name: string; value?: AxValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
};
type RemoteResult = { result: { value?: unknown; objectId?: string; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
type TabLogs = { console: string[]; requests: Map<string, { method: string; url: string; status: string }> };

export const browserEnabled = () => Boolean(process.env.BROWSERBASE_API_KEY);

const browserbaseConnector: BrowserConnector = async () => {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error('Browser tools need a Browserbase API key: set BROWSERBASE_API_KEY (and optionally BROWSERBASE_PROJECT_ID).');
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  const headers = { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' };
  const response = await fetch(`${BROWSERBASE_API_URL}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(projectId ? { projectId } : {}),
  });
  if (!response.ok) throw new Error(`Browserbase could not start a session: ${response.status} ${await response.text()}`);
  const session = await response.json() as { id: string; connectUrl: string };
  const debug = await fetch(`${BROWSERBASE_API_URL}/sessions/${session.id}/debug`, { headers })
    .then((res) => (res.ok ? res.json() as Promise<{ debuggerFullscreenUrl?: string }> : undefined))
    .catch(() => undefined);
  return {
    connectUrl: session.connectUrl,
    liveViewUrl: debug?.debuggerFullscreenUrl,
    release: async () => {
      await fetch(`${BROWSERBASE_API_URL}/sessions/${session.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ status: 'REQUEST_RELEASE', ...(projectId && { projectId }) }),
      });
    },
  };
};

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'listbox', 'treeitem',
]);
const HIDDEN_ROLES = new Set([
  '', 'generic', 'none', 'presentation', 'InlineTextBox', 'LineBreak', 'RootWebArea',
  'LayoutTable', 'LayoutTableRow', 'LayoutTableCell',
]);
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const STATE_PROPERTIES = ['checked', 'selected', 'expanded', 'pressed', 'disabled', 'required', 'focused', 'level'];

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
};
const MODIFIERS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

const CLEAR_VALUE_FN = `function() {
  if (this.isContentEditable) this.textContent = '';
  else if ('value' in this) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value')?.set;
    setter ? setter.call(this, '') : (this.value = '');
  }
  this.dispatchEvent(new Event('input', { bubbles: true }));
}`;

const SELECT_OPTIONS_FN = `function(values) {
  if (this.tagName !== 'SELECT') throw new Error('Element is not a <select>; click it and pick an option instead.');
  const options = [...this.options];
  const picked = values.map((v) => options.find((o) => o.value === v || o.label.trim() === v || o.textContent.trim() === v));
  const missing = values.filter((_, i) => !picked[i]);
  if (missing.length) throw new Error('No option matching ' + missing.join(', ') + '. Options: ' + options.map((o) => o.label.trim()).join(', '));
  options.forEach((o) => { o.selected = picked.includes(o); });
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return picked.map((o) => o.label.trim());
}`;

const FIELD_KIND_FN = `function() {
  if (this.tagName === 'SELECT') return 'select';
  const role = this.getAttribute('role');
  if (this.type === 'checkbox' || this.type === 'radio' || role === 'checkbox' || role === 'radio' || role === 'switch') return 'toggle';
  return 'text';
}`;

const IS_CHECKED_FN = `function() { return typeof this.checked === 'boolean' ? this.checked : this.getAttribute('aria-checked') === 'true'; }`;

const parseRef = (ref: string): number => {
  const match = /^@?(?:ref=)?e(\d+)$/.exec(ref.trim());
  if (!match) throw new Error(`Invalid ref "${ref}". Use a ref from the latest browser snapshot, like "e12".`);
  return Number(match[1]);
};

const clip = (text: string, max = 120) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const describeNode = (node: AxNode, role: string, name: string, interactive: boolean) => {
  const properties = Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value?.value]));
  const states = STATE_PROPERTIES.flatMap((key) => {
    const value = properties[key];
    if (value === undefined || value === false || value === 'false') return [];
    return [value === true || value === 'true' ? key : `${key}=${String(value)}`];
  });
  const value = VALUE_ROLES.has(role) ? String(node.value?.value ?? '') : '';
  return [
    role === 'StaticText' ? 'text' : role,
    name ? JSON.stringify(name) : '',
    value ? `value=${JSON.stringify(clip(value))}` : '',
    ...states.map((state) => `[${state}]`),
    interactive ? `[ref=e${node.backendDOMNodeId}]` : '',
  ].filter(Boolean).join(' ');
};

/** Renders an accessibility tree as indented lines; interactive elements get `[ref=e<backendNodeId>]`, which stays valid while the DOM node exists. */
export const renderAxTree = (nodes: AxNode[], interactiveOnly: boolean, rootId = nodes[0]?.nodeId): string[] => {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const lines: string[] = [];
  const visit = (id: string, depth: number, parentName: string) => {
    const node = byId.get(id);
    if (!node) return;
    const role = String(node.role?.value ?? '');
    const name = clip(String(node.name?.value ?? '').replace(/\s+/g, ' ').trim());
    const focusable = node.properties?.some((property) => property.name === 'focusable' && property.value?.value === true);
    const interactive = !node.ignored && node.backendDOMNodeId !== undefined
      && (INTERACTIVE_ROLES.has(role) || (focusable === true && name !== '' && !HIDDEN_ROLES.has(role) && role !== 'StaticText'));
    const visible = !node.ignored && !HIDDEN_ROLES.has(role)
      && !(role === 'StaticText' && (!/[\p{L}\p{N}]/u.test(name) || parentName.includes(name)))
      && (!interactiveOnly || interactive || role === 'heading');
    if (visible) lines.push(`${'  '.repeat(interactiveOnly ? 0 : depth)}- ${describeNode(node, role, name, interactive)}`);
    for (const child of node.childIds ?? []) visit(child, visible ? depth + 1 : depth, visible && name ? name : parentName);
  };
  if (rootId) visit(rootId, 0, '');
  return lines;
};

class BrowserSession {
  private connection?: CdpConnection;
  private release?: () => Promise<void>;
  private liveViewUrl?: string;
  private targetId?: string;
  private sessionId?: string;
  private attached = new Map<string, string>();
  private logs = new Map<string, TabLogs>();
  private starting?: Promise<string>;
  private connector: BrowserConnector = browserbaseConnector;

  /** Swaps how browser sessions are created (tests point this at a local CDP endpoint). */
  setConnector(connector: BrowserConnector) {
    this.connector = connector;
  }

  async navigate({ url, action = 'goto' }: { url?: string; action?: 'goto' | 'back' | 'forward' | 'reload' }): Promise<string> {
    const notice = await this.ensure();
    if (action === 'reload') await this.page('Page.reload');
    else if (action === 'back' || action === 'forward') {
      const { currentIndex, entries } = await this.page<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory');
      const entry = entries[currentIndex + (action === 'back' ? -1 : 1)];
      if (!entry) throw new Error(`There is no page to go ${action} to.`);
      await this.page('Page.navigateToHistoryEntry', { entryId: entry.id });
    } else {
      if (!url) throw new Error('url is required to navigate.');
      const target = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
      const { errorText } = await this.page<{ errorText?: string }>('Page.navigate', { url: target });
      if (errorText) throw new Error(`Navigation to ${target} failed: ${errorText}`);
    }
    await this.settle();
    return `${notice}${await this.snapshot({ interactive: false })}`;
  }

  async snapshot({ interactive = false, selector }: { interactive?: boolean; selector?: string } = {}): Promise<string> {
    const notice = await this.ensure();
    const { nodes } = await this.page<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
    let rootId = nodes[0]?.nodeId;
    if (selector) {
      const { result } = await this.page<RemoteResult>('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
      if (!result.objectId) throw new Error(`No element matches selector ${selector}.`);
      const { node } = await this.page<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: result.objectId });
      rootId = nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId)?.nodeId;
      if (!rootId) throw new Error(`Selector ${selector} has no accessibility node; try a parent element.`);
    }
    const { targetInfo } = await this.connection!.send<{ targetInfo: TargetInfo }>('Target.getTargetInfo', { targetId: this.targetId });
    const tabs = (await this.pages()).length;
    let body = renderAxTree(nodes, interactive, rootId).join('\n') || '(no accessible content)';
    if (body.length > BROWSER_SNAPSHOT_MAX_CHARS) {
      body = `${body.slice(0, BROWSER_SNAPSHOT_MAX_CHARS)}\n… (snapshot truncated; pass a selector to scope it or interactive: true)`;
    }
    const header = [`Page: ${targetInfo.title}`, `URL: ${targetInfo.url}`, ...(tabs > 1 ? [`Tabs: ${tabs} (see browser_tabs)`] : [])];
    return `${notice}${header.join('\n')}\n\n${body}`;
  }

  async click({ ref, x, y, button = 'left', doubleClick = false, modifiers = [] }: { ref?: string; x?: number; y?: number; button?: 'left' | 'right' | 'middle'; doubleClick?: boolean; modifiers?: string[] }) {
    return this.act(async () => {
      const point = await this.point(ref, x, y);
      const mask = modifiers.reduce((total, key) => total | (MODIFIERS[key.toLowerCase()] ?? 0), 0);
      await this.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, modifiers: mask });
      for (let clickCount = 1; clickCount <= (doubleClick ? 2 : 1); clickCount++) {
        await this.page('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount, modifiers: mask });
        await this.page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, clickCount, modifiers: mask });
      }
      return `Clicked ${ref ?? `(${point.x}, ${point.y})`}.`;
    });
  }

  async type({ ref, text, submit = false, clear = true }: { ref: string; text: string; submit?: boolean; clear?: boolean }) {
    return this.act(async () => {
      await this.typeInto(parseRef(ref), text, clear);
      if (submit) await this.key('Enter');
      return `Typed into ${ref}${submit ? ' and pressed Enter' : ''}.`;
    });
  }

  async fillForm({ fields }: { fields: { ref: string; value: string | boolean }[] }) {
    return this.act(async () => {
      const done: string[] = [];
      for (const { ref, value } of fields) {
        const id = parseRef(ref);
        const kind = await this.callOn<string>(id, FIELD_KIND_FN);
        if (kind === 'select') await this.callOn(id, SELECT_OPTIONS_FN, [[String(value)]]);
        else if (kind === 'toggle') {
          const want = value === true || /^(true|on|yes|checked|1)$/i.test(String(value));
          if (await this.callOn<boolean>(id, IS_CHECKED_FN) !== want) await this.clickNode(id);
        } else await this.typeInto(id, String(value), true);
        done.push(ref);
      }
      return `Filled ${done.length} field${done.length === 1 ? '' : 's'}: ${done.join(', ')}.`;
    });
  }

  async selectOption({ ref, values }: { ref: string; values: string[] }) {
    return this.act(async () => {
      const picked = await this.callOn<string[]>(parseRef(ref), SELECT_OPTIONS_FN, [values]);
      return `Selected ${picked.map((label) => JSON.stringify(label)).join(', ')} in ${ref}.`;
    });
  }

  async pressKey({ key }: { key: string }) {
    return this.act(async () => {
      await this.key(key);
      return `Pressed ${key}.`;
    });
  }

  async hover({ ref, x, y }: { ref?: string; x?: number; y?: number }) {
    return this.act(async () => {
      const point = await this.point(ref, x, y);
      await this.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      return `Hovered ${ref ?? `(${point.x}, ${point.y})`}.`;
    });
  }

  async scroll({ ref, direction = 'down', amount = 600 }: { ref?: string; direction?: 'up' | 'down' | 'left' | 'right'; amount?: number }) {
    return this.act(async () => {
      if (ref) {
        await this.page('DOM.scrollIntoViewIfNeeded', { backendNodeId: parseRef(ref) });
        return `Scrolled ${ref} into view.`;
      }
      const { cssLayoutViewport } = await this.page<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics');
      const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
      const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
      await this.page('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: cssLayoutViewport.clientWidth / 2, y: cssLayoutViewport.clientHeight / 2, deltaX, deltaY,
      });
      return `Scrolled ${direction} ${amount}px.`;
    });
  }

  async wait({ text, selector, gone = false, seconds, timeout = 10 }: { text?: string; selector?: string; gone?: boolean; seconds?: number; timeout?: number }) {
    return this.act(async () => {
      if (seconds !== undefined) {
        await Bun.sleep(seconds * 1000);
        return `Waited ${seconds}s.`;
      }
      if (!text && !selector) throw new Error('Pass text, selector, or seconds.');
      const check = text
        ? `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`
        : `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
      const what = text ? `text ${JSON.stringify(text)}` : `selector ${selector}`;
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        if (await this.evaluateValue(check).catch(() => !gone) !== gone) return `${what} ${gone ? 'is gone' : 'appeared'}.`;
        await Bun.sleep(250);
      }
      throw new Error(`Timed out after ${timeout}s waiting for ${what} to ${gone ? 'disappear' : 'appear'}.`);
    });
  }

  async screenshot({ ref, fullPage = false }: { ref?: string; fullPage?: boolean }): Promise<string> {
    const notice = await this.ensure();
    const metrics = await this.page<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number }; cssContentSize: { width: number; height: number } }>('Page.getLayoutMetrics');
    let clipRect: { x: number; y: number; width: number; height: number; scale: number } | undefined;
    if (ref) {
      const id = parseRef(ref);
      await this.page('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }).catch(() => undefined);
      const quad = await this.quad(id);
      const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
      const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
      const { cssVisualViewport } = await this.page<typeof metrics>('Page.getLayoutMetrics');
      clipRect = {
        x: Math.min(...xs) + cssVisualViewport.pageX,
        y: Math.min(...ys) + cssVisualViewport.pageY,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        scale: 1,
      };
    } else if (fullPage) {
      clipRect = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 };
    }
    const { data } = await this.page<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      ...(clipRect && { clip: clipRect }),
      ...(fullPage && { captureBeyondViewport: true }),
    });
    const dir = await mkdtemp(join(tmpdir(), 'fl0w-browser-'));
    const path = join(dir, 'screenshot.png');
    await writeFile(path, Buffer.from(data, 'base64'));
    const viewport = metrics.cssVisualViewport;
    const subject = ref
      ? `element ${ref}`
      : fullPage
        ? `full page (${metrics.cssContentSize.width}x${metrics.cssContentSize.height} CSS px)`
        : `viewport (${viewport.clientWidth}x${viewport.clientHeight} CSS px; x/y in this image can be passed to browser_click)`;
    return `${notice}Screenshot of ${subject}.\n[image:${path}]`;
  }

  async tabs({ action = 'list', index, url }: { action?: 'list' | 'new' | 'select' | 'close'; index?: number; url?: string }): Promise<string> {
    const notice = await this.ensure();
    const pick = async () => {
      const page = (await this.pages())[index ?? -1];
      if (!page) throw new Error(`No tab at index ${index}. Call browser_tabs with action "list" to see tabs.`);
      return page;
    };
    if (action === 'new') {
      const { targetId } = await this.connection!.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      await this.attach(targetId);
      if (url) return `${notice}${await this.navigate({ url })}`;
    } else if (action === 'select') {
      await this.attach((await pick()).targetId);
      return `${notice}${await this.snapshot({ interactive: true })}`;
    } else if (action === 'close') {
      const { targetId } = await pick();
      await this.connection!.send('Target.closeTarget', { targetId });
      this.forget(targetId);
      if (targetId === this.targetId) {
        const next = (await this.pages()).find((page) => page.targetId !== targetId);
        if (next) await this.attach(next.targetId);
        else this.sessionId = undefined;
      }
    }
    const pages = await this.pages();
    const list = pages.map((page, i) => `${i}: ${page.targetId === this.targetId ? '* ' : ''}${page.title || '(untitled)'} — ${page.url}`);
    return `${notice}${list.join('\n') || 'No open tabs.'}`;
  }

  async evaluate({ expression }: { expression: string }): Promise<string> {
    const notice = await this.ensure();
    const value = await this.evaluateValue(expression, true);
    return `${notice}${value === undefined ? 'undefined' : JSON.stringify(value, null, 2)}`;
  }

  async readLogs({ kind = 'console', clear = false, filter }: { kind?: 'console' | 'network'; clear?: boolean; filter?: string }): Promise<string> {
    const notice = await this.ensure();
    const logs = this.tabLogs(this.sessionId!);
    const lines = kind === 'console'
      ? logs.console
      : [...logs.requests.values()].map((request) => `${request.method} ${request.status} ${request.url}`);
    const shown = filter ? lines.filter((line) => line.includes(filter)) : lines;
    if (clear) kind === 'console' ? (logs.console = []) : logs.requests.clear();
    return `${notice}${shown.join('\n') || `No ${kind} entries${filter ? ` matching ${JSON.stringify(filter)}` : ''}.`}`;
  }

  async close(): Promise<string> {
    if (!this.connection) return 'No browser session is open.';
    this.connection.close();
    await this.release?.().catch(() => undefined);
    this.reset();
    return 'Browser session closed.';
  }

  private reset() {
    this.connection = undefined;
    this.release = undefined;
    this.liveViewUrl = undefined;
    this.targetId = undefined;
    this.sessionId = undefined;
    this.attached.clear();
    this.logs.clear();
  }

  /** Connects on first use (and reconnects after the session ends); returns a notice for the model when a new session started. */
  private async ensure(): Promise<string> {
    if (this.connection && !this.connection.closed) {
      if (!this.sessionId) {
        const page = (await this.pages())[0];
        await this.attach(page?.targetId ?? (await this.connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })).targetId);
      }
      return '';
    }
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<string> {
    const lost = this.connection !== undefined;
    this.reset();
    const { connectUrl, liveViewUrl, release } = await this.connector();
    const connection = await CdpConnection.connect(connectUrl);
    this.connection = connection;
    this.release = release;
    this.liveViewUrl = liveViewUrl;
    connection.on((event) => this.onEvent(event));
    await connection.send('Target.setDiscoverTargets', { discover: true });
    const page = (await this.pages())[0];
    await this.attach(page?.targetId ?? (await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })).targetId);
    const notices = [
      lost ? 'The previous browser session ended, so a new one was started (earlier tabs and logins are gone).' : 'Started a new browser session.',
      ...(this.liveViewUrl ? [`Live view (share it with the user when they need to log in, pass 2FA, or watch): ${this.liveViewUrl}`] : []),
    ];
    return `${notices.join('\n')}\n\n`;
  }

  private async pages(): Promise<TargetInfo[]> {
    const { targetInfos } = await this.connection!.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
    return targetInfos.filter((target) => target.type === 'page' && !/^(chrome-extension|devtools):/.test(target.url));
  }

  private async attach(targetId: string) {
    let sessionId = this.attached.get(targetId);
    if (!sessionId) {
      sessionId = (await this.connection!.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      this.attached.set(targetId, sessionId);
      await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable']
        .map((method) => this.connection!.send(method, {}, sessionId)));
    }
    this.targetId = targetId;
    this.sessionId = sessionId;
    await this.connection!.send('Target.activateTarget', { targetId }).catch(() => undefined);
  }

  private forget(targetId: string) {
    const sessionId = this.attached.get(targetId);
    this.attached.delete(targetId);
    if (sessionId) this.logs.delete(sessionId);
  }

  private tabLogs(sessionId: string): TabLogs {
    let logs = this.logs.get(sessionId);
    if (!logs) this.logs.set(sessionId, logs = { console: [], requests: new Map() });
    return logs;
  }

  private onEvent({ method, params, sessionId }: CdpEvent) {
    if (method === 'Target.detachedFromTarget') {
      const detached = [...this.attached].find(([, id]) => id === params.sessionId)?.[0];
      if (detached) this.forget(detached);
      if (params.sessionId === this.sessionId) this.sessionId = undefined;
      return;
    }
    if (!sessionId) return;
    const logs = this.tabLogs(sessionId);
    if (method === 'Runtime.consoleAPICalled') {
      const args = (params.args as { value?: unknown; description?: string }[] | undefined) ?? [];
      logs.console.push(`[${String(params.type)}] ${args.map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? '')).join(' ')}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails as { text?: string; exception?: { description?: string } };
      logs.console.push(`[exception] ${details.exception?.description ?? details.text ?? 'Unknown error'}`);
    } else if (method === 'Network.requestWillBeSent') {
      const request = params.request as { method: string; url: string };
      if (!request.url.startsWith('data:')) logs.requests.set(String(params.requestId), { method: request.method, url: request.url, status: 'pending' });
    } else if (method === 'Network.responseReceived') {
      const entry = logs.requests.get(String(params.requestId));
      if (entry) entry.status = String((params.response as { status: number }).status);
    } else if (method === 'Network.loadingFailed') {
      const entry = logs.requests.get(String(params.requestId));
      if (entry) entry.status = `failed(${String(params.errorText)})`;
    }
    if (logs.console.length > BROWSER_LOG_LIMIT) logs.console.splice(0, logs.console.length - BROWSER_LOG_LIMIT);
    while (logs.requests.size > BROWSER_LOG_LIMIT) logs.requests.delete(logs.requests.keys().next().value!);
  }

  private page<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.connection!.send<T>(method, params, this.sessionId);
  }

  /** Runs an action, lets the page settle, follows any tab it opened, and returns the result with a fresh interactive snapshot. */
  private async act(action: () => Promise<string>): Promise<string> {
    const notice = await this.ensure();
    const before = new Set((await this.pages()).map((page) => page.targetId));
    let result: string;
    try {
      result = await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/No node with given id|Could not find node|No node found/i.test(message)) {
        throw new Error('That ref is no longer on the page. Take a new browser_snapshot and use a fresh ref.');
      }
      if (/Could not compute content quads|not visible/i.test(message)) {
        throw new Error('That element is not visible (hidden or zero-size). Pick another ref, or scroll or open the section that contains it first.');
      }
      throw error;
    }
    await this.settle();
    const opened = (await this.pages()).find((page) => !before.has(page.targetId));
    if (opened) {
      await this.attach(opened.targetId);
      await this.settle();
      result += ' It opened a new tab, which is now selected.';
    }
    return `${notice}${result}\n\n${await this.snapshot({ interactive: true })}`;
  }

  private async settle() {
    await Bun.sleep(300);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await this.evaluateValue('document.readyState').catch(() => undefined) === 'complete') return;
      await Bun.sleep(200);
    }
  }

  private async evaluateValue(expression: string, replMode = false): Promise<unknown> {
    const response = await this.page<RemoteResult>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Evaluation failed.');
    }
    return response.result.value;
  }

  private async callOn<T>(backendNodeId: number, functionDeclaration: string, args: unknown[] = []): Promise<T> {
    const { object } = await this.page<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId });
    const response = await this.page<RemoteResult>('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description?.split('\n')[0] ?? response.exceptionDetails.text ?? 'Element call failed.');
    }
    return response.result.value as T;
  }

  private async quad(backendNodeId: number): Promise<number[]> {
    const { quads } = await this.page<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId });
    const quad = quads[0];
    if (!quad) throw new Error('The element is not visible on the page.');
    return quad;
  }

  private async point(ref: string | undefined, x: number | undefined, y: number | undefined) {
    if (ref) {
      const id = parseRef(ref);
      await this.page('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }).catch(() => undefined);
      const quad = await this.quad(id);
      return { x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4, y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4 };
    }
    if (x === undefined || y === undefined) throw new Error('Pass a ref, or x and y viewport coordinates.');
    return { x, y };
  }

  private async clickNode(backendNodeId: number) {
    const point = await this.point(`e${backendNodeId}`, undefined, undefined);
    await this.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.page('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await this.page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }

  private async typeInto(backendNodeId: number, text: string, clear: boolean) {
    await this.page('DOM.focus', { backendNodeId }).catch(() => this.clickNode(backendNodeId));
    if (clear) await this.callOn(backendNodeId, CLEAR_VALUE_FN);
    if (text) await this.page('Input.insertText', { text });
  }

  private async key(combo: string) {
    const parts = combo.split('+').map((part) => part.trim()).filter(Boolean);
    const key = parts.pop() ?? '';
    const modifiers = parts.reduce((total, part) => {
      const bit = MODIFIERS[part.toLowerCase()];
      if (bit === undefined) throw new Error(`Unknown modifier "${part}". Use Alt, Control, Meta, or Shift.`);
      return total | bit;
    }, 0);
    const name = KEYS[key] ? key : Object.keys(KEYS).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) ?? key;
    const definition = KEYS[name] ?? (key.length === 1
      ? { code: /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : '', keyCode: key.toUpperCase().charCodeAt(0), text: key }
      : undefined);
    if (!definition) throw new Error(`Unknown key "${key}". Use a single character or one of: ${Object.keys(KEYS).join(', ')}.`);
    const text = modifiers & ~8 ? undefined : definition.text;
    const base = { key: name === 'Space' ? ' ' : name, code: definition.code, windowsVirtualKeyCode: definition.keyCode, modifiers };
    await this.page('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text }) });
    await this.page('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
}

export const browserSession = new BrowserSession();
