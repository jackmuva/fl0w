import { describe, expect, test } from 'bun:test';
import type { PrepareStepFunction, ToolSet } from 'ai';
import { MAX_ITERATIONS, PLAN_CHECK_MAX_RETRIES } from '../../../constants';
import { DEFAULT_CREATE_PLAN_TOOL } from '../default-tools/tool-utils';
import { preparePlanStep } from './plan-agent';

describe('preparePlanStep', () => {
  const options = (stepNumber: number) => ({ stepNumber }) as Parameters<PrepareStepFunction<ToolSet>>[0];

  test('preserves discovered tools and uses auto tool choice', async () => {
    const prepare = preparePlanStep(async () => ({ activeTools: ['read'], toolChoice: 'required' }));
    expect(await prepare(options(0))).toEqual({ activeTools: ['read'], toolChoice: 'auto' });
  });

  test('exposes only create_plan on final steps without forcing a named tool choice', async () => {
    const prepare = preparePlanStep(async () => ({ activeTools: ['read'] }));
    expect(await prepare(options(MAX_ITERATIONS - PLAN_CHECK_MAX_RETRIES - 1))).toEqual({
      activeTools: [DEFAULT_CREATE_PLAN_TOOL],
      toolChoice: 'auto',
    });
  });
});
