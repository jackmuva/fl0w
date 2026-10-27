import type { CapabilitySelection, CapabilityCatalog, CapabilityKind, Fl0wMessage } from '../models/agent';
import {type McpTool, mcpToolKey } from '../models/mcp';
import { discoverAgentsMd } from './agent/hooks/front-load';
import { skillService } from './external-tools/skill-service';
import { userToolLoader } from './external-tools/user-tool-service';
import { mcpClient } from './external-tools/mcp-client';
import { runStartupSync,finishHeadlessRun } from './setup';
import { frontLoadMessages } from "./agent/hooks/front-load";
import { fl0wMessage } from "./agent/utils/message-utils";

const CATALOG_KINDS: CapabilityKind[] = ['skills', 'mcpServers', 'userTools', 'agentsMd'];

export const buildCapabilityCatalog = async (): Promise<CapabilityCatalog> => ({
  skills: await skillService.discoverSkills(),
  mcpServers: (await mcpClient.listTools()).map((tool) => ({
    name: mcpToolKey(tool),
    description: tool.description,
  })),
  userTools: userToolLoader.listUserTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
  })),
  agentsMd: await discoverAgentsMd(),
});

const printCatalogLines = (catalog: CapabilityCatalog): void => {
  for (const kind of CATALOG_KINDS) {
    const items = [...catalog[kind]].sort((a, b) => a.name.localeCompare(b.name));
    for (const { name, description } of items) {
      console.log(JSON.stringify({ kind, name, ...(description !== undefined && { description }) }));
    }
  }
};

export const runCapabilitiesCommand = async (_argv: string[]): Promise<number> => {
  const syncWarning = await runStartupSync({ log: console.error });
  if (syncWarning) console.error(syncWarning);

  console.error('Connecting MCPs...');
  try {
    await mcpClient.loadConfig();
    for (const status of await mcpClient.connectAll()) {
      if (!status.connected) console.error(`[mcp] ${status.server} not connected: ${status.error}`);
    }
  } catch (e) {
    console.error(`Error with MCP process: ${e}`);
  }
  await userToolLoader.loadUserTools();

  printCatalogLines(await buildCapabilityCatalog());
  await mcpClient.close();
  return 0;
};

export const runCapabilitiesCli = async (argv: string[]): Promise<number> =>
  finishHeadlessRun(await runCapabilitiesCommand(argv));

let selection: CapabilitySelection | null = null;

export const getCapabilitySelection = () => selection;

export const setCapabilitySelection = (next: CapabilitySelection) => {
  selection = next;
};

export const isCapabilityEnabled = (kind: CapabilityKind, name: string) =>
  selection !== null && selection[kind].includes(name);

export const isMcpToolEnabled = (tool: Pick<McpTool, 'server' | 'name'>) => {
  if (!selection) return false;
  const key = mcpToolKey(tool);
  if (selection.mcpServers.includes(key)) return true;
  return selection.mcpServers.includes(tool.server);
};

export const emptyCapabilitySelection = (): CapabilitySelection => ({
  skills: [],
  mcpServers: [],
  userTools: [],
  agentsMd: [],
});

const union = (left: string[], right: string[]) => [...new Set([...left, ...right])];

export const mergeCapabilitySelection = (
  current: CapabilitySelection | null,
  required: CapabilitySelection,
): CapabilitySelection => ({
  skills: union(current?.skills ?? [], required.skills),
  mcpServers: union(current?.mcpServers ?? [], required.mcpServers),
  userTools: union(current?.userTools ?? [], required.userTools),
  agentsMd: union(current?.agentsMd ?? [], required.agentsMd),
});

export const applyCapabilitySelection = async (
  next: CapabilitySelection,
): Promise<Fl0wMessage[]> => {
  setCapabilitySelection(next);
  const messages = await frontLoadMessages();
  return messages.map((message) => fl0wMessage(message));
};

export const isCatalogEmpty = (catalog: CapabilityCatalog) =>
  catalog.skills.length
  + catalog.mcpServers.length
  + catalog.userTools.length
  + catalog.agentsMd.length === 0;
