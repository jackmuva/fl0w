import { describe, expect, test } from 'bun:test';
import {
  emptyCapabilitySelection,
  isMcpToolEnabled,
  mergeCapabilitySelection,
  setCapabilitySelection,
} from './config';

describe('mergeCapabilitySelection', () => {
  test('merges capabilities additively', () => {
    const current = {
      skills: ['demo-skill'],
      mcpServers: ['github'],
      userTools: [],
      agentsMd: [],
    };
    const required = {
      skills: ['other-skill'],
      mcpServers: ['github', 'slack'],
      userTools: ['deploy'],
      agentsMd: ['AGENTS.md'],
    };

    expect(mergeCapabilitySelection(current, required)).toEqual({
      skills: ['demo-skill', 'other-skill'],
      mcpServers: ['github', 'slack'],
      userTools: ['deploy'],
      agentsMd: ['AGENTS.md'],
    });
  });

  test('treats null current selection as empty', () => {
    const required = emptyCapabilitySelection();
    required.mcpServers = ['github'];

    expect(mergeCapabilitySelection(null, required)).toEqual({
      skills: [],
      mcpServers: ['github'],
      userTools: [],
      agentsMd: [],
    });
  });

  test('deduplicates overlapping entries', () => {
    const selection = {
      skills: ['demo-skill'],
      mcpServers: ['github'],
      userTools: ['deploy'],
      agentsMd: ['AGENTS.md'],
    };

    expect(mergeCapabilitySelection(selection, selection)).toEqual(selection);
  });
});

describe('isMcpToolEnabled', () => {
  test('enables a tool when its key is selected', () => {
    setCapabilitySelection({
      ...emptyCapabilitySelection(),
      mcpServers: ['github/create_issue'],
    });
    expect(isMcpToolEnabled({ server: 'github', name: 'create_issue' })).toBe(true);
    expect(isMcpToolEnabled({ server: 'github', name: 'list_repos' })).toBe(false);
  });

  test('treats a legacy server name as enabling all tools on that server', () => {
    setCapabilitySelection({
      ...emptyCapabilitySelection(),
      mcpServers: ['github'],
    });
    expect(isMcpToolEnabled({ server: 'github', name: 'create_issue' })).toBe(true);
    expect(isMcpToolEnabled({ server: 'slack', name: 'post_message' })).toBe(false);
  });
});
