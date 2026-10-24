import type { CapabilityCatalog, CapabilityKind } from '../models/agent';
import { mcpToolKey } from '../models/mcp';
import { discoverAgentsMd, discoverSkills } from '../services/agent/hooks/front-load';
import { listUserTools, loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { finishHeadlessRun } from './utils';
import { runStartupSync } from './utils';

const CATALOG_KINDS: CapabilityKind[] = ['skills', 'mcpServers', 'userTools', 'agentsMd'];

export const buildCapabilityCatalog = async (): Promise<CapabilityCatalog> => ({
  skills: await discoverSkills(),
  mcpServers: (await mcpClient.listTools()).map((tool) => ({
    name: mcpToolKey(tool),
    description: tool.description,
  })),
  userTools: listUserTools().map((tool) => ({
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
  await loadUserTools();

  printCatalogLines(await buildCapabilityCatalog());
  await mcpClient.close();
  return 0;
};

export const runCapabilitiesCli = async (argv: string[]): Promise<number> =>
  finishHeadlessRun(await runCapabilitiesCommand(argv));
