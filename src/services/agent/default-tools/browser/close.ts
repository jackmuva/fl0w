import { jsonSchema, tool } from 'ai';
import { closeBrowser } from '../../../browser/browser-session';
import type { DefaultToolEntry } from '../index';

const description = 'Closes the automated Chrome browser. The fl0w browser profile (logins, cookies) is kept for next time.';

const inputSchema = { type: 'object', properties: {} } as const;

const execute = async (): Promise<string> => (await closeBrowser()) ? 'Browser closed.' : 'Browser was not running.';

export const browserCloseTool: DefaultToolEntry = {
  name: 'browser_close',
  description,
  inputSchema,
  execute,
  tool: tool({ description, inputSchema: jsonSchema<Record<string, never>>(inputSchema), execute }),
};
