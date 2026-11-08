import { jsonSchema, tool } from 'ai';
import { browserSession } from '../../browser/browser-session';
import type { DefaultToolEntry } from '.';

const REF = {
  type: 'string',
  description: 'Element ref from the latest browser snapshot, e.g. "e12". Refs stay valid while the element exists; after navigation take a new snapshot.',
};
const X = { type: 'number', description: 'Viewport x coordinate in CSS pixels (from a viewport browser_screenshot). Use instead of ref.' };
const Y = { type: 'number', description: 'Viewport y coordinate in CSS pixels (from a viewport browser_screenshot). Use instead of ref.' };

const browserTool = <T,>(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  execute: (input: T) => Promise<string>,
): DefaultToolEntry => {
  const inputSchema = jsonSchema<T>({ type: 'object', properties, required });
  return {
    name,
    description,
    inputSchema: inputSchema.jsonSchema as Record<string, unknown>,
    execute: (args) => execute(args as T),
    tool: tool({ description, inputSchema, execute }),
  };
};

export const browserToolEntries: DefaultToolEntry[] = [
  browserTool(
    'browser_navigate',
    `Open a URL (or go back, forward, or reload) in a cloud browser (Browserbase) and return an accessibility snapshot of the page.

- The browser, its tabs, and its logins persist across calls for this session.
- Snapshots list page content as an indented tree; interactive elements carry refs like [ref=e12] that the other browser_* tools act on.
- When the user must log in, pass 2FA, or solve something themselves, give them the live view URL from the first browser result (via ask_question when available) and continue once they confirm.
- Saved workflows must not reuse refs: snapshot first and pick the element by its role and name.`,
    {
      url: { type: 'string', description: 'URL to open (https:// is assumed when no scheme is given). Required for "goto".' },
      action: { type: 'string', enum: ['goto', 'back', 'forward', 'reload'], description: 'Defaults to "goto".' },
    },
    [],
    (input: Parameters<typeof browserSession.navigate>[0]) => browserSession.navigate(input),
  ),
  browserTool(
    'browser_snapshot',
    'Return the current page as an accessibility tree: roles, names, values, states, and [ref=eN] on interactive elements. Prefer this over screenshots to read the page and find refs. Use interactive: true for a compact list of controls only.',
    {
      interactive: { type: 'boolean', description: 'Only list interactive elements and headings (default false).' },
      selector: { type: 'string', description: 'CSS selector to scope the snapshot to one part of the page.' },
    },
    [],
    (input: Parameters<typeof browserSession.snapshot>[0]) => browserSession.snapshot(input),
  ),
  browserTool(
    'browser_click',
    'Click an element by ref (or at viewport x/y from a screenshot). Returns the result and a fresh interactive snapshot; if the click opens a new tab it becomes the selected tab.',
    {
      ref: REF,
      x: X,
      y: Y,
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Defaults to left.' },
      doubleClick: { type: 'boolean', description: 'Double-click instead of a single click.' },
      modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] }, description: 'Modifier keys held during the click.' },
    },
    [],
    (input: Parameters<typeof browserSession.click>[0]) => browserSession.click(input),
  ),
  browserTool(
    'browser_type',
    'Type text into an input, textarea, or contenteditable element. Replaces the current value unless clear is false. Set submit to press Enter afterwards.',
    {
      ref: REF,
      text: { type: 'string', description: 'Text to type.' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
      clear: { type: 'boolean', description: 'Clear the existing value first (default true).' },
    },
    ['ref', 'text'],
    (input: Parameters<typeof browserSession.type>[0]) => browserSession.type(input),
  ),
  browserTool(
    'browser_fill_form',
    'Fill several form fields in one call. Text inputs get the value typed, <select> elements pick the option whose value or label matches, and checkboxes, radios, and switches are set on (true) or off (false). Does not submit; click the submit button afterwards.',
    {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: REF,
            value: { type: ['string', 'boolean'], description: 'Text, option value/label, or true/false for toggles.' },
          },
          required: ['ref', 'value'],
        },
      },
    },
    ['fields'],
    (input: Parameters<typeof browserSession.fillForm>[0]) => browserSession.fillForm(input),
  ),
  browserTool(
    'browser_select_option',
    'Choose one or more options in a native <select> by option value or visible label.',
    {
      ref: REF,
      values: { type: 'array', items: { type: 'string' }, description: 'Option values or labels to select.' },
    },
    ['ref', 'values'],
    (input: Parameters<typeof browserSession.selectOption>[0]) => browserSession.selectOption(input),
  ),
  browserTool(
    'browser_press_key',
    'Press a key or key combination in the focused element, e.g. "Enter", "Escape", "Tab", "ArrowDown", "a", "Control+a", "Shift+Tab".',
    { key: { type: 'string', description: 'Key name, optionally prefixed with modifiers joined by "+".' } },
    ['key'],
    (input: Parameters<typeof browserSession.pressKey>[0]) => browserSession.pressKey(input),
  ),
  browserTool(
    'browser_hover',
    'Move the mouse over an element by ref (or at viewport x/y), e.g. to open a hover menu or tooltip.',
    { ref: REF, x: X, y: Y },
    [],
    (input: Parameters<typeof browserSession.hover>[0]) => browserSession.hover(input),
  ),
  browserTool(
    'browser_scroll',
    'Scroll the page by a number of pixels, or scroll an element into view by ref. Use it to load lazy content or reach elements below the fold.',
    {
      ref: REF,
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Defaults to down.' },
      amount: { type: 'number', description: 'Pixels to scroll (default 600).' },
    },
    [],
    (input: Parameters<typeof browserSession.scroll>[0]) => browserSession.scroll(input),
  ),
  browserTool(
    'browser_wait',
    'Wait until text or a CSS selector appears (or disappears with gone: true), or for a fixed number of seconds. Use it when content loads asynchronously instead of taking repeated snapshots.',
    {
      text: { type: 'string', description: 'Visible text to wait for.' },
      selector: { type: 'string', description: 'CSS selector to wait for.' },
      gone: { type: 'boolean', description: 'Wait for the text or selector to disappear instead.' },
      seconds: { type: 'number', description: 'Wait a fixed number of seconds instead.' },
      timeout: { type: 'number', description: 'Give up after this many seconds (default 10).' },
    },
    [],
    (input: Parameters<typeof browserSession.wait>[0]) => browserSession.wait(input),
  ),
  browserTool(
    'browser_screenshot',
    'Take a PNG screenshot of the viewport, the full page, or one element, and attach it as an image. Use it for visual checks (layout, charts, canvas, images) that a snapshot cannot show. Coordinates in a viewport screenshot can be passed to browser_click and browser_hover.',
    {
      ref: { ...REF, description: 'Only capture this element.' },
      fullPage: { type: 'boolean', description: 'Capture the whole scrollable page instead of the viewport.' },
    },
    [],
    (input: Parameters<typeof browserSession.screenshot>[0]) => browserSession.screenshot(input),
  ),
  browserTool(
    'browser_tabs',
    'List, open, select, or close browser tabs. "list" shows tab indexes; the selected tab is marked with *.',
    {
      action: { type: 'string', enum: ['list', 'new', 'select', 'close'], description: 'Defaults to list.' },
      index: { type: 'number', description: 'Tab index for select or close.' },
      url: { type: 'string', description: 'URL to open in the new tab.' },
    },
    [],
    (input: Parameters<typeof browserSession.tabs>[0]) => browserSession.tabs(input),
  ),
  browserTool(
    'browser_evaluate',
    'Run JavaScript in the selected page and return the JSON-serializable result. Top-level await is allowed. Use it to read data the snapshot does not show or to drive widgets the other tools cannot.',
    { expression: { type: 'string', description: 'JavaScript expression or statements; the last expression is returned.' } },
    ['expression'],
    (input: Parameters<typeof browserSession.evaluate>[0]) => browserSession.evaluate(input),
  ),
  browserTool(
    'browser_logs',
    'Read the selected tab\'s console messages and uncaught errors, or its network requests (method, status, URL). Useful for debugging web apps.',
    {
      kind: { type: 'string', enum: ['console', 'network'], description: 'Defaults to console.' },
      filter: { type: 'string', description: 'Only return lines containing this text.' },
      clear: { type: 'boolean', description: 'Clear the buffer after reading.' },
    },
    [],
    (input: Parameters<typeof browserSession.readLogs>[0]) => browserSession.readLogs(input),
  ),
  browserTool(
    'browser_close',
    'Close the browser session and end the Browserbase session. Cookies and tabs are lost; the next browser tool call starts a fresh session.',
    {},
    [],
    () => browserSession.close(),
  ),
];
