import { describe, expect, test } from 'bun:test';
import { fl0wMessage, toModelMessages } from './fl0w-message';

describe('toModelMessages', () => {
  test('places conversation summaries after system messages for the model', () => {
    const messages = [
      fl0wMessage({ role: 'system', content: 'rules' }),
      fl0wMessage({ role: 'user', content: 'latest ask' }),
      fl0wMessage({ role: 'assistant', content: 'recent reply' }),
      fl0wMessage({ role: 'assistant', content: 'condensed history' }, 'summary'),
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
      fl0wMessage({ role: 'user', content: 'go' }),
      fl0wMessage({ role: 'assistant', content: '{"selectedTool":"x","probabilities":{}}' }, 'decision'),
    ];

    expect(toModelMessages(messages)).toEqual([{ role: 'user', content: 'go' }]);
  });
});
