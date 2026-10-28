import type { ToolSet } from "ai";
import type { SubagentType } from "../../models/agent";
import type { McpTool } from "../../models/mcp";
import { USER_TOOL_SERVER } from "../../constants";
import { DEFAULT_TOOL_SERVER } from "./default-tools/tool-utils";
import { listAllTools, toAiSdkTools } from "./utils/tool-utils";

type Toolpack = 'all' | { exclude: string[] } | { default: string[], mcp?: boolean };

export const TOOLPACKS: Record<SubagentType, Toolpack> = {
  ROUTING: { default: [] },
  DISCOVERY: {
    default: ['read', 'grep', 'glob', 'list_dir', 'read_full_tool_output', 'load_skill', 'websearch', 'webfetch', 'ask_question'],
    mcp: true,
  },
  PLAN: { default: ['create_plan'] },
  EXECUTE: { exclude: ['ask_question', 'create_plan'] },
};

const inToolpack = (pack: Toolpack, entry: McpTool) => {
  if (pack === 'all') return true;
  if ('exclude' in pack) return !(entry.server === DEFAULT_TOOL_SERVER && pack.exclude.includes(entry.name));
  if (entry.server === DEFAULT_TOOL_SERVER) return pack.default.includes(entry.name);
  return entry.server !== USER_TOOL_SERVER && pack.mcp === true;
};

export const toolsFor = async (subagent: SubagentType): Promise<ToolSet | undefined> => {
  const pack = TOOLPACKS[subagent];
  if (pack !== 'all' && 'default' in pack && pack.default.length === 0 && !pack.mcp) return undefined;
  const tools = (await listAllTools()).filter((entry) => inToolpack(pack, entry));
  return tools.length > 0 ? toAiSdkTools(tools) : undefined;
};
