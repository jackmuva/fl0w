import { jsonSchema, tool } from 'ai';
import { snapshot } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserSnapshotInput = { wait_for_text?: string, timeout_seconds?: number };

const description = `Returns the current page's URL, title, numbered interactive elements (links, buttons, inputs, selects, checkboxes, ...) with their labels and current values, and the visible page text.
Refs in the output are what browser_click, browser_fill, and browser_press_key target. Refs are renumbered on every snapshot and after navigation, so use refs from the latest snapshot.`;

const inputSchema = {
  type: 'object',
  properties: {
    wait_for_text: { type: 'string', description: 'Wait until this text appears on the page before snapshotting' },
    timeout_seconds: { type: 'number', description: 'How long to wait for wait_for_text (default 10)' },
  },
} as const;

const execute = (args: BrowserSnapshotInput) =>
  snapshot({ waitForText: args.wait_for_text, timeoutMs: args.timeout_seconds ? args.timeout_seconds * 1000 : undefined });

export const browserSnapshotTool: DefaultToolEntry = {
  name: 'browser_snapshot',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserSnapshotInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserSnapshotInput>(inputSchema), execute }),
};
