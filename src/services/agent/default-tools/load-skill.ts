import { jsonSchema, tool } from 'ai';
import { skillService } from '../../external-tools/skill-service';

export type LoadSkillInput = {
  name: string;
};

const loadSkillInputSchema = jsonSchema<LoadSkillInput>({
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'The skill name from the available skills catalog',
    },
  },
  required: ['name'],
});

export const loadSkillDescription =
  'Load the full instructions for a skill by name. ' +
  'Call this when a task matches a skill listed in the available skills catalog.';

export const loadSkillToolSchema = loadSkillInputSchema.jsonSchema as Record<string, unknown>;

export const executeLoadSkill = async ({ name }: LoadSkillInput): Promise<string> => {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Error: skill name is required';
  }

  const available = skillService.listSkills().map((skill) => skill.name);
  if (available.length === 0) {
    return 'No skills are configured.';
  }

  const content = await skillService.loadSkillContent(trimmed);
  if (content === null) {
    return `Unknown skill "${trimmed}". Available skills: ${available.join(', ')}`;
  }

  return content;
};

export const loadSkillTool = tool({
  description: loadSkillDescription,
  inputSchema: loadSkillInputSchema,
  execute: executeLoadSkill,
});
