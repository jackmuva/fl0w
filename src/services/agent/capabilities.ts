import type { CapabilityCatalog, CapabilityKind, CapabilitySelection, Fl0wMessage } from "../../models/agent";
import type { McpTool } from "../../models/mcp";
import { mcpToolKey } from "../../models/mcp";
import { discoverSkills, frontLoadMessages } from "./hooks/front-load";
import { scheduleMirrorEnabledSkills } from "../skills/mirror-enabled-skills";
import { fl0wMessage } from "./utils/fl0w-message";

let selection: CapabilitySelection | null = null;

export const getCapabilitySelection = () => selection;

export const setCapabilitySelection = (next: CapabilitySelection) => {
  selection = next;
};

export const isCapabilityEnabled = (kind: CapabilityKind, name: string) =>
  selection !== null && selection[kind].includes(name);

/** Whether an MCP tool is enabled in the current session selection. */
export const isMcpToolEnabled = (tool: Pick<McpTool, 'server' | 'name'>) => {
  if (!selection) return false;
  const key = mcpToolKey(tool);
  if (selection.mcpServers.includes(key)) return true;
  // Legacy sessions/workflows may store a server name to enable all of its tools.
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
  scheduleMirrorEnabledSkills(next, await discoverSkills());
  return (await frontLoadMessages()).map((message) => fl0wMessage(message));
};

export const isCatalogEmpty = (catalog: CapabilityCatalog) =>
  catalog.skills.length
  + catalog.mcpServers.length
  + catalog.userTools.length
  + catalog.agentsMd.length === 0;
