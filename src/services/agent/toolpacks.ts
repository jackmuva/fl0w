import type { SubagentType } from "../../models/agent";
import type { McpTool } from "../../models/mcp";
import { USER_TOOL_SERVER } from "../../constants";
import { DEFAULT_TOOL_SERVER } from "./default-tools/tool-utils";
import { listAllTools, toAiSdkTools } from "./utils/tool-utils";
import { withToolSearch, type ToolOptions } from "./tool-search";
import { withImageParts } from "./utils/message-utils";
import { modelStore } from "../../store/model-store";

type Toolpack = 'all' | { exclude: string[] } | { default: string[], mcp?: boolean };

const EXECUTE_EXCLUDE = ['ask_question', 'create_plan'];

export const TOOLPACKS: Record<SubagentType, Toolpack> = {
  ROUTER: { default: [] },
  DISCOVERY: {
    default: [
      'read', 'grep', 'glob', 'list_dir', 'read_full_tool_output', 'load_skill', 'search_skills', 'websearch', 'webfetch', 'ask_question',
      'browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_tabs', 'browser_scroll', 'browser_wait',
    ],
    mcp: true,
  },
  PLAN: { default: ['create_plan'] },
  EXECUTE: { exclude: EXECUTE_EXCLUDE },
};

const inToolpack = (pack: Toolpack, entry: McpTool) => {
  if (pack === 'all') return true;
  if ('exclude' in pack) return !(entry.server === DEFAULT_TOOL_SERVER && pack.exclude.includes(entry.name));
  if (entry.server === DEFAULT_TOOL_SERVER) return pack.default.includes(entry.name);
  return entry.server !== USER_TOOL_SERVER && pack.mcp === true;
};

const toolsForPack = async (pack: Toolpack): Promise<ToolOptions | undefined> => {
  if (pack !== 'all' && 'default' in pack && pack.default.length === 0 && !pack.mcp) return undefined;
  const tools = (await listAllTools()).filter((entry) => inToolpack(pack, entry));
  if (tools.length === 0) return undefined;
  const options = withToolSearch(tools, toAiSdkTools(tools));
  return {
    ...options,
    prepareStep: async (step) => {
      const prepared = await options.prepareStep?.(step);
      const model = typeof step.model === 'string' ? step.model : step.model.modelId;
      if (!(await modelStore.supportsImages(model))) return prepared;
      const messages = await withImageParts(step.messages);
      return messages === step.messages ? prepared : { ...prepared, messages };
    },
  };
};

export const toolsFor = (subagent: SubagentType) => toolsForPack(TOOLPACKS[subagent]);

/** Tools for a child agent started by the `subagent` tool: EXECUTE's tools minus delegation and plan tracking. */
export const toolsForSubagent = () => toolsForPack({ exclude: [...EXECUTE_EXCLUDE, 'subagent', 'mark_step_complete'] });
