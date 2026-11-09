import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import { attachToolImages } from './image-attachments';
import { MAX_ATTACHED_IMAGES } from '../../../constants';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const toolResult = (id: string, value: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: 'default__browser_screenshot', output: { type: 'text', value } }],
});

const outputOf = (message: ModelMessage | undefined) => {
  if (message?.role !== 'tool') throw new Error('expected tool message');
  const part = message.content[0];
  if (part?.type !== 'tool-result') throw new Error('expected tool result');
  return part.output;
};

const writePng = async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'fl0w-test-')), 'shot.png');
  await writeFile(path, PNG);
  return path;
};

describe('attachToolImages', () => {
  test('leaves messages without image markers untouched', async () => {
    const messages = [toolResult('a', 'plain output')];
    expect(await attachToolImages(messages)).toBe(messages);
  });

  test('attaches the image file referenced by a marker', async () => {
    const path = await writePng();
    const [message] = await attachToolImages([toolResult('a', `Screenshot saved\n[image:${path}]`)]);
    const output = outputOf(message);
    expect(output.type).toBe('content');
    if (output.type !== 'content') return;
    expect(output.value[0]).toEqual({ type: 'text', text: `Screenshot saved\n[image:${path}]` });
    expect(output.value[1]).toEqual({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: PNG.toString('base64') } });
  });

  test('is idempotent when re-applied to its own output', async () => {
    const path = await writePng();
    const once = await attachToolImages([toolResult('a', `[image:${path}]`), toolResult('b', '[image:/missing/x.png]')]);
    const twice = await attachToolImages(once);
    expect(twice).toEqual(once);
  });

  test('notes missing images instead of failing', async () => {
    const [message] = await attachToolImages([toolResult('a', '[image:/missing/x.png]')]);
    expect(outputOf(message)).toEqual({ type: 'text', value: '[image:/missing/x.png]\n(image /missing/x.png is no longer available)' });
  });

  test('only attaches the most recent results', async () => {
    const path = await writePng();
    const messages = Array.from({ length: MAX_ATTACHED_IMAGES + 2 }, (_, i) => toolResult(String(i), `[image:${path}]`));
    const result = await attachToolImages(await attachToolImages(messages));
    const types = result.map((message) => outputOf(message).type);
    expect(types).toEqual([...Array(2).fill('text'), ...Array(MAX_ATTACHED_IMAGES).fill('content')]);
  });
});
