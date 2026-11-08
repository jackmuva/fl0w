import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLastUserAndAssistantMessages, fl0wMessage, withImageParts } from './message-utils';

const user = (content: string) => fl0wMessage({ role: 'user', content });
const assistant = (content: string) => fl0wMessage({ role: 'assistant', content }, 'EXECUTE');
const toolCall = fl0wMessage({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'default__read', input: { path: 'a.ts' } }],
}, 'DISCOVERY');

const contents = (messages: ModelMessage[]) => messages.map((message) => message.content);

describe('findLastUserAndAssistantMessages', () => {
  test('returns only the user message on a first turn', () => {
    expect(contents(findLastUserAndAssistantMessages([user('hi')]))).toEqual(['hi']);
  });

  test('keeps the previous reply before the latest user message', () => {
    const messages = [user('fix it'), assistant('should I patch a.ts?'), user('yes')];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['should I patch a.ts?', 'yes']);
  });

  test('returns the phase reply after the user message', () => {
    const messages = [user('old'), assistant('old reply'), user('new'), assistant('found the bug')];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['new', 'found the bug']);
  });

  test('skips trailing tool-call-only assistant steps', () => {
    const messages = [user('go'), assistant('scoped the task'), toolCall];
    expect(contents(findLastUserAndAssistantMessages(messages))).toEqual(['go', 'scoped the task']);
  });
});

describe('withImageParts', () => {
  const toolResult = (id: string, value: string): ModelMessage => ({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: id, toolName: 'default__browser_screenshot', output: { type: 'text', value } }],
  });

  test('expands only the newest markers and reverts older expansions to text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fl0w-images-'));
    const paths = await Promise.all(['a', 'b'].map(async (name) => {
      const path = join(dir, `${name}.png`);
      await Bun.write(path, new Uint8Array([137, 80, 78, 71]));
      return path;
    }));
    const messages = [toolResult('c1', `Shot\n[image:${paths[0]}]`), toolResult('c2', `Shot\n[image:${paths[1]}]`), toolResult('c3', 'no image')];

    const first = await withImageParts(messages, 1);
    const outputs = first.map((message) => (message.content as Array<{ output: { type: string, value: unknown } }>)[0]!.output);
    expect(outputs[0]).toEqual({ type: 'text', value: `Shot\n[image:${paths[0]}]` });
    expect(outputs[1]!.type).toBe('content');
    expect(outputs[1]!.value).toEqual([
      { type: 'text', text: `Shot\n[image:${paths[1]}]` },
      { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'iVBORw==' } },
    ]);
    expect(first[2]).toBe(messages[2]!);

    const later = await withImageParts([...first, toolResult('c4', `New\n[image:${paths[0]}]`)], 1);
    expect((later[1]!.content as Array<{ output: unknown }>)[0]!.output).toEqual({ type: 'text', value: `Shot\n[image:${paths[1]}]` });
    expect((later[3]!.content as Array<{ output: { type: string } }>)[0]!.output.type).toBe('content');
    await rm(dir, { recursive: true, force: true });
  });

  test('returns the same array when there is nothing to expand', async () => {
    const messages = [toolResult('c1', 'plain'), toolResult('c2', '[image:/missing/file.png]')];
    expect(await withImageParts(messages)).toBe(messages);
  });
});
