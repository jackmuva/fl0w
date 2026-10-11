import { writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { jsonSchema, tool } from 'ai';
import { IMAGE_MIMES } from './utils';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export type WebFetchInput = {
  url: string;
  format?: 'text' | 'markdown' | 'html';
  timeout?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

const webFetchInputSchema = jsonSchema<WebFetchInput>({
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'The URL to fetch content from',
    },
    format: {
      type: 'string',
      enum: ['text', 'markdown', 'html'],
      description: 'The format to return the content in (text, markdown, or html). Defaults to markdown.',
    },
    timeout: {
      type: 'number',
      description: 'Optional timeout in seconds (max 120)',
    },
  },
  required: ['url'],
});

export const webFetchDescription = `- Fetches content from a specified URL
- Takes a URL and optional format as input
- Fetches the URL content, converts to requested format (markdown by default)
- Returns the content in the specified format
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - The URL must be a fully-formed valid URL
  - Format options: "markdown" (default), "text", or "html"
  - This tool is read-only and does not modify any files
  - Results may be truncated if the content is very large`;

const extractTextFromHtml = (html: string) => {
  let text = '';
  let skipDepth = 0;
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const full = match[0];
    const tag = match[1]?.toLowerCase();
    const textContent = match[2];

    if (tag) {
      if (full.startsWith('</')) {
        if (skipDepth > 0) skipDepth--;
        continue;
      }
      if (['script', 'style', 'noscript', 'iframe', 'object', 'embed'].includes(tag)) {
        skipDepth++;
      }
      continue;
    }

    if (skipDepth === 0 && textContent) text += textContent;
  }

  return text.replace(/\s+/g, ' ').trim();
};

const convertHtmlToMarkdown = (html: string) => {
  let markdown = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '');

  return markdown.replace(/\n{3,}/g, '\n\n').trim();
};

export const executeWebFetch = async ({ url, format = 'markdown', timeout }: WebFetchInput): Promise<string> => {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://');
  }

  const timeoutMs = Math.min((timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, MAX_TIMEOUT_MS);
  const acceptHeader = format === 'html'
    ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    : format === 'text'
      ? 'text/plain;q=1.0, text/html;q=0.8, */*;q=0.1'
      : 'text/markdown;q=1.0, text/html;q=0.8, text/plain;q=0.7, */*;q=0.1';

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; fl0w/0.1.0)',
      Accept: acceptHeader,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
    throw new Error('Response too large (exceeds 5MB limit)');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (IMAGE_MIMES.has(mime)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error('Response too large (exceeds 5MB limit)');
    }
    const dir = await mkdtemp(join(tmpdir(), 'jev-fetch-'));
    const path = join(dir, `image${IMAGE_EXTENSIONS[mime] ?? '.img'}`);
    await writeFile(path, bytes);
    return `Image fetched (${mime}, ${bytes.byteLength} bytes)\n[image:${path}]`;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_SIZE) {
    throw new Error('Response too large (exceeds 5MB limit)');
  }

  const content = new TextDecoder().decode(buffer);

  switch (format) {
    case 'html':
      return content;
    case 'text':
      return contentType.includes('text/html') ? extractTextFromHtml(content) : content;
    case 'markdown':
    default:
      return contentType.includes('text/html') ? convertHtmlToMarkdown(content) : content;
  }
};

export const webFetchTool = tool({
  description: webFetchDescription,
  inputSchema: webFetchInputSchema,
  execute: executeWebFetch,
});

export const webFetchToolSchema = webFetchInputSchema.jsonSchema as Record<string, unknown>;
