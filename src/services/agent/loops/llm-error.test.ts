import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { formatAgentRunError } from './llm-error';

describe('formatAgentRunError', () => {
  test('returns context guidance for context limit API errors', () => {
    const message = formatAgentRunError(new APICallError({
      message: 'Request context length exceeded',
      url: 'https://example.com',
      requestBodyValues: {},
      statusCode: 400,
    }));

    expect(message).toContain('context limit');
  });

  test('includes status for other API errors', () => {
    const message = formatAgentRunError(new APICallError({
      message: 'Invalid API key',
      url: 'https://example.com',
      requestBodyValues: {},
      statusCode: 401,
    }));

    expect(message).toContain('401');
    expect(message).toContain('Invalid API key');
  });
});
