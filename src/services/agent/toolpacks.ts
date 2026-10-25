import type { ToolSet } from "ai";
import type { SubagentType } from "../../models/agent";
import type { McpTool } from "../../models/mcp";
import { USER_TOOL_SERVER } from "../../constants";
import { DEFAULT_TOOL_SERVER } from "./default-tools/utils";
import { listAllTools, toAiSdkTools } from "./utils/tools";

// Which tools each subagent may call. Default tools are listed by bare name; `mcp` adds every enabled MCP tool.
type Toolpack = 'all' | { default: string[], mcp?: boolean };

export const TOOLPACKS: Record<SubagentType, Toolpack> = {
  ROUTING: { default: [] },
  DISCOVERY: {
    default: ['read', 'grep', 'glob', 'list_dir', 'read_full_tool_output', 'load_skill', 'websearch', 'webfetch', 'ask_question'],
    mcp: true,
  },
  PLAN: { default: ['create_plan'] },
  EXECUTE: 'all',
  SUMMARY: { default: [] },
};

const inToolpack = (pack: Toolpack, entry: McpTool) => {
  if (pack === 'all') return true;
  if (entry.server === DEFAULT_TOOL_SERVER) return pack.default.includes(entry.name);
  return entry.server !== USER_TOOL_SERVER && pack.mcp === true;
};

export const toolsFor = async (subagent: SubagentType): Promise<ToolSet | undefined> => {
  const pack = TOOLPACKS[subagent];
  if (pack !== 'all' && pack.default.length === 0 && !pack.mcp) return undefined;
  const tools = (await listAllTools()).filter((entry) => inToolpack(pack, entry));
  return tools.length > 0 ? toAiSdkTools(tools) : undefined;
};
