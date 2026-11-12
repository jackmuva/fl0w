import type { Subprocess } from 'bun';

export type BrowserTarget = {
  ref?: number,
  selector?: string,
  text?: string,
}

export type BrowserFillField = BrowserTarget & {
  value?: string | boolean | string[],
  /** `<name>.<field>` from secrets.json, typed in place of `value` so the model never sees it. */
  secret?: string,
}

export type PageTarget = { id: string, type: string, url: string, title: string, webSocketDebuggerUrl?: string };

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

/** On-disk shape of browser-state.json (cookies and origin storage synced between machines). */
export type BrowserStateFile = {
  version: 1;
  cookies: BrowserCookie[];
  /** Origin -> localStorage entries. */
  localStorage: Record<string, Record<string, string>>;
  /**
   * Origin -> sessionStorage entries (e.g. MSAL keeps its tokens there). Chrome scopes sessionStorage to one tab, so
   * import seeds it into the tab fl0w drives, where it lasts until that tab closes.
   */
  sessionStorage: Record<string, Record<string, string>>;
};

export type OriginStorage = Pick<BrowserStateFile, 'localStorage' | 'sessionStorage'>;

/** CDP connection surface used by browser-state import/export and the live session. */
export type Cdp = {
  send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  waitForEvent: (method: string, timeoutMs: number) => Promise<boolean>;
  onEvent: (listener: (method: string, params: Record<string, unknown>) => void) => () => void;
};

/** Attached tab connection (`Cdp` plus lifecycle used by the session). */
export type TabCdp = Cdp & { close(): void, closed: boolean };

export type BrowserState = {
  process: Subprocess,
  port: number,
  browserPath: string,
  headless: boolean,
  page?: { id: string, cdp: TabCdp },
  knownTargets: Set<string>,
  /** Headed only: periodically saves logins, since the user can quit Chrome before fl0w gets to export them. */
  snapshotTimer?: ReturnType<typeof setInterval>,
};

export type CdpMessage = { id?: number, method?: string, params?: Record<string, unknown>, result?: unknown, error?: { message: string } };

export type EvaluateResult = {
  result: { value?: unknown, objectId?: string },
  exceptionDetails?: { exception?: { description?: string }, text: string },
};
