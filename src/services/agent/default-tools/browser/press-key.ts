import { jsonSchema, tool } from 'ai';
import type { BrowserTarget } from '../../../../models/browser';
import { pressKeyAndSettle } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserPressKeyInput = BrowserTarget & { key: string };

const description = 'Presses a key or key combo (e.g. "Enter", "Tab", "Escape", "ArrowDown", "PageDown", "Shift+Tab", "Control+a") on the focused element, or on the element given by ref/selector/text. Waits for any navigation and returns a fresh snapshot.';

const inputSchema = {
  type: 'object',
  properties: {
    key: { type: 'string', description: 'Key or combo to press' },
    ref: { type: 'number', description: 'Element ref number from the latest browser_snapshot (preferred)' },
    selector: { type: 'string', description: 'CSS selector, when no ref is available' },
    text: { type: 'string', description: 'Visible label/text of the element, when no ref is available' },
  },
  required: ['key'],
} as const;

const execute = ({ key, ...target }: BrowserPressKeyInput) => pressKeyAndSettle(key, target);

export const browserPressKeyTool: DefaultToolEntry = {
  name: 'browser_press_key',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserPressKeyInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserPressKeyInput>(inputSchema), execute }),
};
