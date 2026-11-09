import { jsonSchema, tool } from 'ai';
import type { BrowserFillField } from '../../../../models/browser';
import { fill } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

type BrowserFillInput = { fields: BrowserFillField[] };

const description = `Fills one or more form fields in order. Each field is targeted by ref (from browser_snapshot), selector, or text, and set to value:
- text inputs, textareas, contenteditable: replaces the content by typing value ("" clears it)
- select: picks the option whose value or visible text matches (array for multi-selects)
- checkbox/radio/switch: true/false (or "yes"/"no") sets the checked state
- date/time/color/range inputs: value in the input's native format (e.g. "2026-01-31")
- file inputs: file path, or array of paths
For usernames, passwords, and other credentials, pass secret ("<name>.<field>" from list_secrets) instead of value; fl0w types the stored value without showing it to you, and only on sites the user allowed for that secret.
Does not submit the form; use browser_click on the submit button or browser_press_key Enter.`;

const inputSchema = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'number', description: 'Element ref number from the latest browser_snapshot (preferred)' },
          selector: { type: 'string', description: 'CSS selector, when no ref is available' },
          text: { type: 'string', description: 'Visible label/text of the element, when no ref is available' },
          value: {
            anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }],
            description: 'Value to set (omit when using secret)',
          },
          secret: { type: 'string', description: 'Stored secret to type instead of value, as "<name>.<field>" (see list_secrets)' },
        },
      },
    },
  },
  required: ['fields'],
} as const;

const execute = (args: BrowserFillInput) => fill(args.fields);

export const browserFillTool: DefaultToolEntry = {
  name: 'browser_fill',
  description,
  inputSchema,
  execute: (args) => execute(args as BrowserFillInput),
  tool: tool({ description, inputSchema: jsonSchema<BrowserFillInput>(inputSchema), execute }),
};
