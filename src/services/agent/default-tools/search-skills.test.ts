import { describe, expect, test } from 'bun:test';
import { skillService, type SkillSummary } from '../../external-tools/skill-service';
import { executeSearchSkills } from './search-skills';

const skills: SkillSummary[] = [
  { name: 'create-issue', description: 'Create GitHub issues for the backlog.', path: '/x/create-issue/SKILL.md' },
  { name: 'weekly-report', description: 'Write the weekly report from Notion and Linear records.', path: '/x/weekly-report/SKILL.md' },
  { name: 'release-notes', description: 'Draft release notes from merged issues.', path: '/x/release-notes/SKILL.md' },
];

describe('executeSearchSkills', () => {
  test('returns skill names, descriptions, and remaining counts', async () => {
    skillService.setActiveSkills(skills);

    const result = JSON.parse(await executeSearchSkills({ query: 'write weekly report' }));
    expect(result.skills[0].name).toBe('weekly-report');
    expect(result.skills[0].description).toContain('Notion');
    expect(result.remaining).toBe(0);
    expect(result.note).toContain('load_skill');
  });

  test('exact names bypass ranking and dedupe against the query', async () => {
    skillService.setActiveSkills(skills);

    const result = JSON.parse(await executeSearchSkills({ names: ['release-notes', 'release-notes'], query: 'release-notes' }));
    expect(result.skills.map((skill: { name: string }) => skill.name)).toEqual(['release-notes']);
    expect(result.remaining).toBe(0);
  });

  test('caps results at limit and falls back to all skills without a query', async () => {
    skillService.setActiveSkills(skills);

    const result = JSON.parse(await executeSearchSkills({ limit: 1 }));
    expect(result.skills).toHaveLength(1);
    expect(result.remaining).toBe(2);
  });

  test('reports no matches for unknown keywords', async () => {
    skillService.setActiveSkills(skills);
    expect(await executeSearchSkills({ query: 'zzz' })).toBe('No matching skills. Try other keywords or exact skill names.');
  });

  test('reports when no skills are configured', async () => {
    skillService.setActiveSkills([]);
    expect(await executeSearchSkills({ query: 'anything' })).toBe('No skills are configured.');
  });
});
