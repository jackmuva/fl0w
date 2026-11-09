import { jsonSchema, tool } from 'ai';
import { screenshot } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserScreenshotInput = { full_page?: boolean };

const description = 'Takes a PNG screenshot of the current browser tab, attaches it so you can see it, and returns its path. Prefer browser_snapshot for reading the page; use this to check layout or visual state.';

const inputSchema = {
  type: 'object',
  properties: { full_page: { type: 'boolean', description: 'Capture the whole scrollable page' } },
} as const;

const execute = (args: BrowserScreenshotInput) => screenshot(args.full_page);

export const browserScreenshotTool: DefaultToolEntry = {
  name: 'browser_screenshot',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserScreenshotInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserScreenshotInput>(inputSchema), execute }),
};
