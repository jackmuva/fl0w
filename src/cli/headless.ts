import { flushPendingSkillMirrors } from '../services/skills/mirror-enabled-skills';
import { flushPendingPushes } from '../services/sync/config-sync';
import { flushSessionPushes } from '../services/sync/session-sync';
import { flushWorkflowPushes } from '../services/sync/workflow-sync';

/** Flush debounced config, workflow, session, and skill sync work before headless exit. */
export async function finishHeadlessRun(code: number): Promise<number> {
  void flushPendingSkillMirrors();
  await Promise.all([flushPendingPushes(), flushWorkflowPushes(), flushSessionPushes()]);
  return code;
}
