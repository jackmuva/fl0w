import { jsonSchema, tool } from 'ai';
import type { BrowserTarget } from '../../../../models/browser';
import { click } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

const description = 'Clicks an element (by ref from browser_snapshot, CSS selector, or visible text) with a real mouse click, waits for any navigation, and returns a fresh snapshot. Switches to a new tab if the click opened one.';

const inputSchema = {
  type: 'object',
  properties: {
    ref: { type: 'number', description: 'Element ref number from the latest browser_snapshot (preferred)' },
    selector: { type: 'string', description: 'CSS selector, when no ref is available' },
    text: { type: 'string', description: 'Visible label/text of the element, when no ref is available' },
  },
} as const;

const execute = (args: BrowserTarget) => click(args);

export const browserClickTool: DefaultToolEntry = {
  name: 'browser_click',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserTarget),
  tool: tool({ description, inputSchema: jsonSchema<BrowserTarget>(inputSchema), execute }),
};
