import { describe, expect, test } from 'bun:test';
import { jevMessage, toModelMessages } from './jev-message';

describe('toModelMessages', () => {
  test('places conversation summaries after system messages for the model', () => {
    const messages = [
      jevMessage({ role: 'system', content: 'rules' }),
      jevMessage({ role: 'user', content: 'latest ask' }),
      jevMessage({ role: 'assistant', content: 'recent reply' }),
      jevMessage({ role: 'assistant', content: 'condensed history' }, 'summary'),
    ];

    expect(toModelMessages(messages).map((m) => m.content)).toEqual([
      'rules',
      'condensed history',
      'latest ask',
      'recent reply',
    ]);
  });

  test('drops decision frames from model input', () => {
    const messages = [
      jevMessage({ role: 'user', content: 'go' }),
      jevMessage({ role: 'assistant', content: '{"selectedTool":"x","probabilities":{}}' }, 'decision'),
    ];

    expect(toModelMessages(messages)).toEqual([{ role: 'user', content: 'go' }]);
  });
});
