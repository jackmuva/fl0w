import type { Fl0wMessage } from '../../../models/agent';
import { buildPlanProgress } from '../../../ui/lib/format/message';
import { DEFAULT_MARK_STEP_COMPLETE_TOOL } from '../default-tools/utils';
import { fl0wMessage } from '../utils/message-utils';

// Returns a reminder for the execution agent when the latest plan has steps never marked complete.
export const planCheckHook = (transcript: Fl0wMessage[]): Fl0wMessage | undefined => {
  const incomplete = buildPlanProgress(transcript)?.steps.filter((step) => !step.done) ?? [];
  if (incomplete.length === 0) return undefined;

  const content = [
    `The plan is not complete. These steps have no ${DEFAULT_MARK_STEP_COMPLETE_TOOL} call:`,
    ...incomplete.map((step) => `${step.index}. ${step.description.trim()}`),
    `Check each incomplete step: finish it if it isn't done, then call ${DEFAULT_MARK_STEP_COMPLETE_TOOL} with its index. If a step is already done, just mark it complete.`,
  ].join('\n');
  return fl0wMessage({ role: 'user', content }, 'EXECUTE');
};
