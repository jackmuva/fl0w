import { jsonSchema, tool } from 'ai';
import { openBrowser } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserOpenInput = { url?: string, headless?: boolean };

const description = `Opens Google Chrome for browser automation (or reuses the open one) and optionally loads a URL. Returns a page snapshot.
The browser uses a persistent fl0w profile (~/.fl0w/browser-profile), so logins made in it are kept across runs. Switching headless mode restarts the browser.
Other browser tools launch the browser automatically if it is not open.`;

const inputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'URL to open' },
    headless: { type: 'boolean', description: 'Run without a visible window (default false when a display is available)' },
  },
} as const;

const execute = (args: BrowserOpenInput) => openBrowser(args);

export const browserOpenTool: DefaultToolEntry = {
  name: 'browser_open',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserOpenInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserOpenInput>(inputSchema), execute }),
};
