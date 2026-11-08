import { jsonSchema, tool } from 'ai';
import type { BrowserFillField, BrowserTarget } from '../../../models/browser';
import {
  click,
  closeBrowser,
  describeBrowser,
  fill,
  listBrowserProfiles,
  listChromeProfiles,
  navigate,
  openBrowser,
  pressKeyAndSettle,
  screenshot,
  snapshot,
} from '../../browser/browser-session';
import type { DefaultToolEntry } from './index';

const targetProperties = {
  ref: { type: 'number', description: 'Element ref number from the latest browser_snapshot (preferred)' },
  selector: { type: 'string', description: 'CSS selector, when no ref is available' },
  text: { type: 'string', description: 'Visible label/text of the element, when no ref is available' },
} as const;

type BrowserOpenInput = { url?: string, profile?: string, chrome_profile?: string, refresh_profile?: boolean, headless?: boolean };
type BrowserNavigateInput = { url?: string, action?: 'back' | 'forward' | 'reload' };
type BrowserSnapshotInput = { wait_for_text?: string, timeout_seconds?: number };
type BrowserFillInput = { fields: BrowserFillField[] };
type BrowserPressKeyInput = BrowserTarget & { key: string };
type BrowserScreenshotInput = { full_page?: boolean };

const entry = <T>(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  execute: (args: T) => Promise<string>,
): DefaultToolEntry => {
  const inputSchema = jsonSchema<T>(schema as Parameters<typeof jsonSchema>[0]);
  return {
    name,
    description,
    inputSchema: schema,
    execute: (args) => execute(args as T),
    tool: tool({ description, inputSchema, execute }),
  };
};

export const browserToolEntries: DefaultToolEntry[] = [
  entry<Record<string, never>>(
    'browser_profiles',
    `Lists browser profiles available to the browser tools:
- fl0w profiles: persistent profiles in ~/.fl0w/browser-profiles (logins made in them are kept)
- Chrome profiles: the user's own Google Chrome profiles, which browser_open can copy via chrome_profile`,
    { type: 'object', properties: {} },
    async () => {
      const [profiles, chrome] = await Promise.all([listBrowserProfiles(), listChromeProfiles()]);
      return [
        describeBrowser(),
        '',
        'fl0w profiles:',
        ...(profiles.length ? profiles.map((p) => `- ${p.name}${p.importedFrom
          ? ` (copy of Chrome profile "${p.importedFrom.name}"${p.importedFrom.email ? `, ${p.importedFrom.email}` : ''}, imported ${p.importedFrom.importedAt})`
          : ''}`) : ['(none yet; "default" is created on first use)']),
        '',
        'Chrome profiles:',
        ...(chrome.length ? chrome.map((p) => `- "${p.name}"${p.email ? ` <${p.email}>` : ''} [${p.directory}]`) : ['(none found)']),
      ].join('\n');
    },
  ),
  entry<BrowserOpenInput>(
    'browser_open',
    `Opens Google Chrome for browser automation (or reuses the open one) and optionally loads a URL. Returns a page snapshot.

Profiles:
- profile: name of a persistent fl0w profile (default "default"). Logins made in it are kept across runs.
- chrome_profile: name, email, or folder (e.g. "Work", "me@example.com", "Profile 1") of one of the user's Chrome profiles. It is copied into a fl0w profile (named "chrome-<name>" unless profile is set) so the browser starts with the user's cookies and logins. The copy is reused on later calls; set refresh_profile to re-copy it.
- Switching profile or headless mode restarts the browser.

Other browser tools launch the "default" profile automatically if no browser is open.`,
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
        profile: { type: 'string', description: 'fl0w browser profile name (default "default")' },
        chrome_profile: { type: 'string', description: "One of the user's Chrome profiles to use (name, email, or folder); see browser_profiles" },
        refresh_profile: { type: 'boolean', description: 'Re-copy chrome_profile even if it was imported before' },
        headless: { type: 'boolean', description: 'Run without a visible window (default false when a display is available)' },
      },
    },
    (args) => openBrowser({
      url: args.url,
      profile: args.profile,
      chromeProfile: args.chrome_profile,
      refreshProfile: args.refresh_profile,
      headless: args.headless,
    }),
  ),
  entry<BrowserNavigateInput>(
    'browser_navigate',
    'Navigates the current browser tab to a URL, or goes back/forward/reloads. Waits for the page to load and returns a snapshot.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to load' },
        action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'History action instead of a URL' },
      },
    },
    (args) => navigate(args),
  ),
  entry<BrowserSnapshotInput>(
    'browser_snapshot',
    `Returns the current page's URL, title, numbered interactive elements (links, buttons, inputs, selects, checkboxes, ...) with their labels and current values, and the visible page text.
Refs in the output are what browser_click, browser_fill, and browser_press_key target. Refs are renumbered on every snapshot and after navigation, so use refs from the latest snapshot.`,
    {
      type: 'object',
      properties: {
        wait_for_text: { type: 'string', description: 'Wait until this text appears on the page before snapshotting' },
        timeout_seconds: { type: 'number', description: 'How long to wait for wait_for_text (default 10)' },
      },
    },
    (args) => snapshot({ waitForText: args.wait_for_text, timeoutMs: args.timeout_seconds ? args.timeout_seconds * 1000 : undefined }),
  ),
  entry<BrowserTarget>(
    'browser_click',
    'Clicks an element (by ref from browser_snapshot, CSS selector, or visible text) with a real mouse click, waits for any navigation, and returns a fresh snapshot. Switches to a new tab if the click opened one.',
    { type: 'object', properties: targetProperties },
    (args) => click(args),
  ),
  entry<BrowserFillInput>(
    'browser_fill',
    `Fills one or more form fields in order. Each field is targeted by ref (from browser_snapshot), selector, or text, and set to value:
- text inputs, textareas, contenteditable: replaces the content by typing value ("" clears it)
- select: picks the option whose value or visible text matches (array for multi-selects)
- checkbox/radio/switch: true/false (or "yes"/"no") sets the checked state
- date/time/color/range inputs: value in the input's native format (e.g. "2026-01-31")
- file inputs: file path, or array of paths
Does not submit the form; use browser_click on the submit button or browser_press_key Enter.`,
    {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ...targetProperties,
              value: {
                anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }],
                description: 'Value to set',
              },
            },
            required: ['value'],
          },
        },
      },
      required: ['fields'],
    },
    (args) => fill(args.fields),
  ),
  entry<BrowserPressKeyInput>(
    'browser_press_key',
    'Presses a key or key combo (e.g. "Enter", "Tab", "Escape", "ArrowDown", "PageDown", "Shift+Tab", "Control+a") on the focused element, or on the element given by ref/selector/text. Waits for any navigation and returns a fresh snapshot.',
    {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or combo to press' },
        ...targetProperties,
      },
      required: ['key'],
    },
    ({ key, ...target }) => pressKeyAndSettle(key, target),
  ),
  entry<BrowserScreenshotInput>(
    'browser_screenshot',
    'Saves a PNG screenshot of the current browser tab and returns its path. Prefer browser_snapshot for reading the page; use this to check layout or visual state.',
    { type: 'object', properties: { full_page: { type: 'boolean', description: 'Capture the whole scrollable page' } } },
    (args) => screenshot(args.full_page),
  ),
  entry<Record<string, never>>(
    'browser_close',
    'Closes the automated Chrome browser. fl0w profile data (logins, cookies) is kept for next time.',
    { type: 'object', properties: {} },
    async () => (await closeBrowser()) ? 'Browser closed.' : 'Browser was not running.',
  ),
];
