import { describe, expect, test } from 'bun:test';
import { DEFAULT_MODELS } from '../../constants';
import { resolveModels } from './agent-loop';

describe('resolveModels', () => {
  test('falls back to defaults when no selection is stored', () => {
    expect(resolveModels(null)).toEqual(DEFAULT_MODELS);
  });

  test('falls back per phase for empty strings', () => {
    const resolved = resolveModels({
      ROUTER: '',
      DISCOVERY: 'openai/gpt-6',
      PLAN: '  ',
      EXECUTE: 'anthropic/claude-sonnet-5.5',
      SUMMARIZE: '',
    });
    expect(resolved).toEqual({
      ...DEFAULT_MODELS,
      DISCOVERY: 'openai/gpt-6',
      EXECUTE: 'anthropic/claude-sonnet-5.5',
    });
  });
});
