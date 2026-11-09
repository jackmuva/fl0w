import { jsonSchema, tool } from 'ai';
import { navigate } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserNavigateInput = { url?: string, action?: 'back' | 'forward' | 'reload' };

const description = 'Navigates the current browser tab to a URL, or goes back/forward/reloads. Waits for the page to load and returns a snapshot.';

const inputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'URL to load' },
    action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'History action instead of a URL' },
  },
} as const;

const execute = (args: BrowserNavigateInput) => navigate(args);

export const browserNavigateTool: DefaultToolEntry = {
  name: 'browser_navigate',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserNavigateInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserNavigateInput>(inputSchema), execute }),
};
