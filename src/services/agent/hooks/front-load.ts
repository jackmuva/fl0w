import type { ModelMessage } from 'ai';
import { join, resolve } from 'path';
import { skillService } from '../../external-tools/skill-service';
import type { WorkflowRecord } from '../../../models/workflow';
import {
  activeWorkflowStore,
  type ActiveWorkflow,
} from '../../../store/active-workflow-store';
import { isCapabilityEnabled } from '../../capabilities';
import { DEFAULT_MARK_STEP_COMPLETE_TOOL } from '../default-tools/utils';

export const AGENTS_MD_FILENAME = 'AGENTS.md';

export type { ActiveWorkflow };
export { activeWorkflowStore };

export const discoverAgentsMd = async (
  rootDir = process.cwd(),
): Promise<Array<{ name: string, description?: string }>> => {
  const agentsPath = join(rootDir, AGENTS_MD_FILENAME);
  const agentsFile = Bun.file(agentsPath);
  if (!(await agentsFile.exists())) return [];

  const content = (await agentsFile.text()).trim();
  if (!content) return [];

  return [{
    name: AGENTS_MD_FILENAME,
    description: 'Workspace agent instructions loaded at session start',
  }];
};

const formatWorkflowStep = (step: WorkflowRecord['steps'][number]): string => {
  const lines = [`### Step ${step.index}: ${step.description}`, step.instructions];
  if (step.tools && step.tools.length > 0) {
    lines.push('Tools:');
    for (const call of step.tools) lines.push(`- ${call.tool}(${JSON.stringify(call.parameters)})`);
  }
  return lines.join('\n');
};

export const formatWorkflowInstructions = ({ workflow, userInstructions }: ActiveWorkflow): string => {
  const extra = userInstructions.trim();
  return [
    `<workflow title="${workflow.title}">`,
    `Goal: ${workflow.goal}`,
    '',
    'You are running this saved workflow. Its plan is already created; follow the steps in order using the listed tools and parameters.',
    `After finishing each step, call ${DEFAULT_MARK_STEP_COMPLETE_TOOL} with that step's index.`,
    'Fill {{placeholder}} parameters from the additional instructions or the workspace. If a listed call fails, adapt its parameters or pick another tool that achieves the step.',
    '',
    workflow.steps.map(formatWorkflowStep).join('\n\n'),
    ...(extra ? ['', '## Additional instructions', extra] : []),
    '</workflow>',
  ].join('\n');
};

export const frontLoadMessages = async (rootDir = process.cwd(), options?: { skillsDirs?: string[] }): Promise<ModelMessage[]> => {
  const workspace = resolve(rootDir);
  const messages: ModelMessage[] = [{
    role: 'system',
    content:
      `Workspace root: ${workspace}\n` +
      'If you have file tools (read, edit, write, list_dir, glob), use paths relative to this directory (e.g. "src/index.ts"). ' +
      'Do not use root-relative paths like "/src/index.ts'
  }];

  const agentsPath = join(rootDir, AGENTS_MD_FILENAME);
  const agentsFile = Bun.file(agentsPath);
  if (await agentsFile.exists() && isCapabilityEnabled('agentsMd', AGENTS_MD_FILENAME)) {
    const content = (await agentsFile.text()).trim();
    if (content) {
      messages.push({ role: 'system', content });
    }
  }

  const skills = (await skillService.discoverSkills(options?.skillsDirs ?? skillService.getSkillsDirs(rootDir)))
    .filter((skill) => isCapabilityEnabled('skills', skill.name));
  skillService.setActiveSkills(skills);
  if (skills.length > 0) {
    messages.push({ role: 'system', content: skillService.formatSkillsCatalog(skills) });
  }

  const workflow = activeWorkflowStore.get();
  if (workflow) {
    messages.push({ role: 'system', content: formatWorkflowInstructions(workflow) });
  }

  return messages;
};

export const frontLoadInstructions = async (
  rootDir = process.cwd(),
  options?: { skillsDirs?: string[] },
): Promise<string> => {
  const messages = await frontLoadMessages(rootDir, options);
  return messages.map((message) => String(message.content)).join('\n\n');
};
