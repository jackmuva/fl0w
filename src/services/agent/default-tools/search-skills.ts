import { jsonSchema, tool } from 'ai';
import { TOOL_SEARCH_DEFAULT_LIMIT } from '../../../constants';
import { skillService, type SkillSummary } from '../../external-tools/skill-service';
import { rankTools } from '../tool-search';

export type SearchSkillsInput = { query?: string; names?: string[]; limit?: number };

const searchSkillsInputSchema = jsonSchema<SearchSkillsInput>({
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Keywords describing the skill, e.g. "write weekly report", or an exact skill name' },
    names: { type: 'array', items: { type: 'string' }, description: 'Exact skill names to load' },
    limit: { type: 'number', description: `Max skills to return (default ${TOOL_SEARCH_DEFAULT_LIMIT})` },
  },
});

export const searchSkillsDescription =
  'Search the installed skills by keyword or name when a task might match one; an empty query lists them all. ' +
  'Then call load_skill with the chosen name before following the skill.';

export const searchSkillsToolSchema = searchSkillsInputSchema.jsonSchema as Record<string, unknown>;

const rankSkills = (skills: SkillSummary[], query: string): SkillSummary[] => {
  const entries = skills.map((skill) => ({ server: '', name: skill.name, description: skill.description, inputSchema: {} }));
  const indexes = new Map(entries.map((entry, index) => [entry.name, index]));
  return rankTools(entries, query)
    .map((entry) => skills[indexes.get(entry.name) ?? -1])
    .filter((skill) => skill !== undefined);
};

export const executeSearchSkills = async ({ query, names, limit }: SearchSkillsInput): Promise<string> => {
  const skills = skillService.listSkills();
  if (skills.length === 0) return 'No skills are configured.';

  const max = Math.max(1, limit ?? TOOL_SEARCH_DEFAULT_LIMIT);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const exact = (names ?? [])
    .map((name) => byName.get(name.trim()))
    .filter((skill): skill is SkillSummary => skill !== undefined);
  const trimmed = query?.trim() ?? '';
  const exactQuery = trimmed ? byName.get(trimmed) : undefined;
  const ranked = exact.length > 0 || exactQuery
    ? [...new Set([...exact, ...(exactQuery ? [exactQuery] : [])])]
    : rankSkills(skills, trimmed);
  const shown = ranked.slice(0, max);
  if (shown.length === 0) return 'No matching skills. Try other keywords or exact skill names.';

  return JSON.stringify({
    skills: shown.map(({ name, description }) => ({ name, description })),
    remaining: ranked.length - shown.length,
    note: 'Call load_skill with the chosen skill name before following it.',
  });
};

export const searchSkillsTool = tool({
  description: searchSkillsDescription,
  inputSchema: searchSkillsInputSchema,
  execute: executeSearchSkills,
});
