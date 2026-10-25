import { describe, expect, test } from 'bun:test';
import { APICallError, UnsupportedFunctionalityError } from 'ai';
import {
  isStructuredOutputUnsupported,
  mergePlanAndInstructions,
  parseJsonObject,
  validateGeneratedInstructions,
  validateGeneratedPlan,
  WorkflowGenerationError,
  type GeneratedPlan,
} from './generate';

const tools = [
  { server: 'default', name: 'grep', description: 'Search files' },
  { server: 'github', name: 'create_pr' },
];

const plan: GeneratedPlan = {
  title: 'Ship feature',
  goal: 'Open a PR for the feature',
  steps: [
    { index: 1, description: 'Find the code' },
    { index: 2, description: 'Open a PR' },
  ],
};

describe('parseJsonObject', () => {
  test('parses raw JSON', () => {
    expect(parseJsonObject('{"title":"T"}')).toEqual({ title: 'T' });
  });

  test('strips markdown fences', () => {
    expect(parseJsonObject('```json\n{"goal":"G"}\n```')).toEqual({ goal: 'G' });
  });

  test('throws on invalid JSON or non-objects', () => {
    expect(() => parseJsonObject('not json')).toThrow(WorkflowGenerationError);
    expect(() => parseJsonObject('[1]')).toThrow(WorkflowGenerationError);
  });
});

describe('validateGeneratedPlan', () => {
  test('sorts, trims, and renumbers steps from 1', () => {
    const validated = validateGeneratedPlan({
      title: ' Ship ',
      goal: 'Goal',
      steps: [
        { index: 5, description: ' second ' },
        { index: 2, description: 'first' },
        { index: 7, description: '  ' },
      ],
    });
    expect(validated).toEqual({
      title: 'Ship',
      goal: 'Goal',
      steps: [
        { index: 1, description: 'first' },
        { index: 2, description: 'second' },
      ],
    });
  });

  test('throws when required fields are missing', () => {
    expect(() => validateGeneratedPlan({ title: 'T', goal: 'G', steps: [] })).toThrow(WorkflowGenerationError);
    expect(() => validateGeneratedPlan({ goal: 'G', steps: [] })).toThrow(WorkflowGenerationError);
  });
});

describe('mergePlanAndInstructions', () => {
  test('joins steps by index and keeps catalog tools with stringified parameters', () => {
    const workflow = mergePlanAndInstructions(plan, validateGeneratedInstructions({
      steps: [
        { index: 2, instructions: 'Open the PR', tools: [{ tool: 'github/create_pr', parameters: { title: '{{title}}', draft: true } }] },
        { index: 1, instructions: ' Search for the handler ', tools: [{ tool: 'default/grep', parameters: { pattern: 'handler' } }] },
      ],
    }), tools);

    expect(workflow.steps).toEqual([
      {
        index: 1,
        description: 'Find the code',
        instructions: 'Search for the handler',
        tools: [{ tool: 'default/grep', parameters: { pattern: 'handler' } }],
      },
      {
        index: 2,
        description: 'Open a PR',
        instructions: 'Open the PR',
        tools: [{ tool: 'github/create_pr', parameters: { title: '{{title}}', draft: 'true' } }],
      },
    ]);
  });

  test('drops tools that are not in the catalog', () => {
    const workflow = mergePlanAndInstructions(plan, {
      steps: [
        { index: 1, instructions: 'Search', tools: [{ tool: 'made/up' }] },
        { index: 2, instructions: 'Open the PR' },
      ],
    }, tools);
    expect(workflow.steps[0]).toEqual({ index: 1, description: 'Find the code', instructions: 'Search' });
  });

  test('throws when a plan step has no instructions', () => {
    expect(() => mergePlanAndInstructions(plan, {
      steps: [{ index: 1, instructions: 'Search' }],
    }, tools)).toThrow(WorkflowGenerationError);
  });
});

describe('isStructuredOutputUnsupported', () => {
  test('detects unsupported functionality errors', () => {
    expect(isStructuredOutputUnsupported(new UnsupportedFunctionalityError({
      functionality: 'structured outputs',
    }))).toBe(true);
  });

  test('detects gateway output format errors', () => {
    expect(isStructuredOutputUnsupported(new APICallError({
      message: 'Model does not support the output format',
      url: 'https://example.com',
      requestBodyValues: {},
    }))).toBe(true);
  });

  test('ignores unrelated API errors', () => {
    expect(isStructuredOutputUnsupported(new APICallError({
      message: 'Rate limit exceeded',
      url: 'https://example.com',
      requestBodyValues: {},
    }))).toBe(false);
  });
});
