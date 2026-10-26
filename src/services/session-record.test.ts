import { describe, expect, test } from 'bun:test';
import { createDraftSession, deriveTitle, nextUpdatedAt } from './session-record';

describe('nextUpdatedAt', () => {
  test('bumps past a same-millisecond previous value', () => {
    const previous = new Date(Date.now() + 500).toISOString();
    expect(nextUpdatedAt(previous)).toBe(new Date(Date.parse(previous) + 1).toISOString());
  });

  test('falls back to the clock for unparseable or far-future values', () => {
    const before = Date.now();
    expect(Date.parse(nextUpdatedAt('abc'))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(nextUpdatedAt('2999-01-01T00:00:00.000Z'))).toBeLessThan(before + 1_000);
  });
});

describe('deriveTitle', () => {
  test('uses the first user text, cut to 80 characters', () => {
    expect(deriveTitle([
      { message: { role: 'assistant', content: 'hello' } },
      { message: { role: 'user', content: [{ type: 'text', text: `  ${'x'.repeat(100)}` }] } },
    ])).toBe(`${'x'.repeat(77)}...`);
    expect(deriveTitle([{ message: { role: 'user', content: '   ' } }])).toBeNull();
  });
});

describe('createDraftSession', () => {
  test('resolves the workspace and keeps a given id', () => {
    const draft = createDraftSession('/tmp/a/../b', 'fixed');
    expect(draft).toMatchObject({ id: 'fixed', workspacePath: '/tmp/b', title: null, capabilities: null });
    expect(draft.createdAt).toBe(draft.updatedAt);
  });
});
