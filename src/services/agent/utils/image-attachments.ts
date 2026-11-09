import { readFile } from 'node:fs/promises';
import type { ModelMessage, ToolResultPart } from 'ai';
import { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } from '../../../constants';
import { IMAGE_MIMES, mimeFromExtension } from '../default-tools/tool-utils';
import type { ToolOptions } from '../tool-search';

/** Image tools (read, webfetch, browser_screenshot) end their text output with this marker. */
const IMAGE_MARKER_PATTERN = /\[image:([^\]\n]+)\]/g;

type ToolOutput = ToolResultPart['output'];
type ContentItem = Extract<ToolOutput, { type: 'content' }>['value'][number];

const outputText = (output: ToolOutput): string | undefined => {
  if (output.type === 'text') return output.value;
  if (output.type === 'content') {
    return output.value.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  }
  return undefined;
};

const imagePaths = (text: string): string[] =>
  [...text.matchAll(IMAGE_MARKER_PATTERN)].map((match) => (match[1] as string).trim());

const loadImage = async (path: string): Promise<ContentItem | string> => {
  const mediaType = mimeFromExtension(path);
  if (!mediaType || !IMAGE_MIMES.has(mediaType)) return `(${path} is not a supported image type)`;
  const bytes = await readFile(path).catch(() => undefined);
  if (!bytes) return `(image ${path} is no longer available)`;
  if (bytes.byteLength > MAX_ATTACHED_IMAGE_BYTES) return `(image ${path} is too large to attach)`;
  return { type: 'file', mediaType, data: { type: 'data', data: bytes.toString('base64') } };
};

const withImages = async (text: string): Promise<ToolOutput> => {
  const loaded = await Promise.all(imagePaths(text).map(loadImage));
  // Skip notes already present: messages carry forward between steps, so this runs on its own output.
  const notes = loaded.filter((item): item is string => typeof item === 'string' && !text.includes(item));
  const files = loaded.filter((item): item is ContentItem => typeof item !== 'string');
  const fullText = notes.length > 0 ? `${text}\n${notes.join('\n')}` : text;
  return files.length > 0
    ? { type: 'content', value: [{ type: 'text', text: fullText }, ...files] }
    : { type: 'text', value: fullText };
};

/**
 * Swaps `[image:<path>]` markers in the latest tool results for the image itself, so the model can see it.
 * Older results fall back to text (path only) to bound request size. The stored transcript is never changed:
 * this runs on the per-request copy, so sessions on disk keep paths instead of base64.
 */
export const attachToolImages = async (messages: ModelMessage[]): Promise<ModelMessage[]> => {
  const targets: Array<{ messageIndex: number, partIndex: number, text: string }> = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'tool') return;
    message.content.forEach((part, partIndex) => {
      if (part.type !== 'tool-result') return;
      const text = outputText(part.output);
      if (text && imagePaths(text).length > 0) targets.push({ messageIndex, partIndex, text });
    });
  });
  if (targets.length === 0) return messages;

  const attach = new Set(targets.slice(-MAX_ATTACHED_IMAGES));
  const outputs = await Promise.all(targets.map(async (target) => ({
    target,
    output: attach.has(target) ? await withImages(target.text) : { type: 'text', value: target.text } as ToolOutput,
  })));

  const next = [...messages];
  for (const { target, output } of outputs) {
    const message = next[target.messageIndex];
    if (message?.role !== 'tool') continue;
    const content = [...message.content];
    const part = content[target.partIndex];
    if (part?.type !== 'tool-result') continue;
    content[target.partIndex] = { ...part, output };
    next[target.messageIndex] = { ...message, content };
  }
  return next;
};

/** Wraps a toolset's prepareStep so every model step sees the latest tool-result images. */
export const withToolImages = (options: ToolOptions): ToolOptions => {
  const { prepareStep } = options;
  return {
    ...options,
    prepareStep: async (step) => {
      const base = await prepareStep?.(step);
      return { ...base, messages: await attachToolImages(base?.messages ?? step.messages) };
    },
  };
};
