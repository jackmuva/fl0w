import type { McpTool, McpToolResult } from '../../../models/mcp';
import { applyPatchDescription, applyPatchTool, applyPatchToolSchema, executeApplyPatch } from './apply-patch';
import {
  askQuestionDescription,
  askQuestionTool,
  askQuestionToolSchema,
} from './ask-question';
import {
  createPlanDescription,
  createPlanTool,
  createPlanToolSchema,
  executeCreatePlan,
} from './create-plan';
import {
  executeMarkStepComplete,
  markStepCompleteDescription,
  markStepCompleteTool,
  markStepCompleteToolSchema,
} from './mark-step-complete';
import { bashDescription, bashTool, bashToolSchema, executeBash } from './bash';
import { editFileDescription, editFileTool, editFileToolSchema, executeEditFile } from './edit-file';
import { executeGlob, globDescription, globTool, globToolSchema } from './glob';
import { executeListDir, listDirDescription, listDirTool, listDirToolSchema } from './list-dir';
import { executeGrep, grepDescription, grepTool, grepToolSchema } from './grep';
import { executeReadFile, readFileDescription, readFileTool, readFileToolSchema } from './read-file';
import {
  executeReadFullToolOutput,
  readFullToolOutputDescription,
  readFullToolOutputTool,
  readFullToolOutputToolSchema,
} from './read-full-tool-output';
import { executeWriteFile, writeFileDescription, writeFileTool, writeFileToolSchema } from './write-file';
import { DEFAULT_TOOL_SERVER } from './utils';
import { executeWebFetch, webFetchDescription, webFetchTool, webFetchToolSchema } from './web-fetch';
import { executeMessageAnswer, messageAnswerDescription, messageAnswerTool, messageAnswerToolSchema } from './message-answer';
import { executeWebSearch, webSearchDescription, webSearchTool, webSearchToolSchema } from './web-search';
import { executeLoadSkill, loadSkillDescription, loadSkillTool, loadSkillToolSchema } from './load-skill';

export type DefaultToolExecutor = (args: Record<string, unknown>) => Promise<string>;

export type DefaultToolEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: DefaultToolExecutor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any;
};

const defaultToolEntries: DefaultToolEntry[] = [
  {
    name: 'message_answer',
    description: messageAnswerDescription,
    inputSchema: messageAnswerToolSchema,
    execute: (args) => executeMessageAnswer(args as Parameters<typeof executeMessageAnswer>[0]),
    tool: messageAnswerTool,
  },
  {
    name: 'create_plan',
    description: createPlanDescription,
    inputSchema: createPlanToolSchema,
    execute: (args) => executeCreatePlan(args as Parameters<typeof executeCreatePlan>[0]),
    tool: createPlanTool,
  },
  {
    name: 'mark_step_complete',
    description: markStepCompleteDescription,
    inputSchema: markStepCompleteToolSchema,
    execute: (args) => executeMarkStepComplete(args as Parameters<typeof executeMarkStepComplete>[0]),
    tool: markStepCompleteTool,
  },
  {
    name: 'ask_question',
    description: askQuestionDescription,
    inputSchema: askQuestionToolSchema,
    execute: (_args: Record<string, unknown>) => Promise.resolve(''),
    tool: askQuestionTool,
  },
  {
    name: 'bash',
    description: bashDescription,
    inputSchema: bashToolSchema,
    execute: (args) => executeBash(args as Parameters<typeof executeBash>[0]),
    tool: bashTool,
  },
  {
    name: 'read',
    description: readFileDescription,
    inputSchema: readFileToolSchema,
    execute: (args) => executeReadFile(args as Parameters<typeof executeReadFile>[0]),
    tool: readFileTool,
  },
  {
    name: 'read_full_tool_output',
    description: readFullToolOutputDescription,
    inputSchema: readFullToolOutputToolSchema,
    execute: (args) => executeReadFullToolOutput(args as Parameters<typeof executeReadFullToolOutput>[0]),
    tool: readFullToolOutputTool,
  },
  {
    name: 'grep',
    description: grepDescription,
    inputSchema: grepToolSchema,
    execute: (args) => executeGrep(args as Parameters<typeof executeGrep>[0]),
    tool: grepTool,
  },
  {
    name: 'edit',
    description: editFileDescription,
    inputSchema: editFileToolSchema,
    execute: (args) => executeEditFile(args as Parameters<typeof executeEditFile>[0]),
    tool: editFileTool,
  },
  {
    name: 'apply_patch',
    description: applyPatchDescription,
    inputSchema: applyPatchToolSchema,
    execute: (args) => executeApplyPatch(args as Parameters<typeof executeApplyPatch>[0]),
    tool: applyPatchTool,
  },
  {
    name: 'write',
    description: writeFileDescription,
    inputSchema: writeFileToolSchema,
    execute: (args) => executeWriteFile(args as Parameters<typeof executeWriteFile>[0]),
    tool: writeFileTool,
  },
  {
    name: 'glob',
    description: globDescription,
    inputSchema: globToolSchema,
    execute: (args) => executeGlob(args as Parameters<typeof executeGlob>[0]),
    tool: globTool,
  },
  {
    name: 'list_dir',
    description: listDirDescription,
    inputSchema: listDirToolSchema,
    execute: (args) => executeListDir(args as Parameters<typeof executeListDir>[0]),
    tool: listDirTool,
  },
  {
    name: 'websearch',
    description: webSearchDescription,
    inputSchema: webSearchToolSchema,
    execute: (args) => executeWebSearch(args as Parameters<typeof executeWebSearch>[0]),
    tool: webSearchTool,
  },
  {
    name: 'webfetch',
    description: webFetchDescription,
    inputSchema: webFetchToolSchema,
    execute: (args) => executeWebFetch(args as Parameters<typeof executeWebFetch>[0]),
    tool: webFetchTool,
  },
  {
    name: 'load_skill',
    description: loadSkillDescription,
    inputSchema: loadSkillToolSchema,
    execute: (args) => executeLoadSkill(args as Parameters<typeof executeLoadSkill>[0]),
    tool: loadSkillTool,
  },
];

const defaultToolMap = new Map(defaultToolEntries.map((entry) => [entry.name, entry]));

export const isDefaultToolKey = (key: string) => key.startsWith(`${DEFAULT_TOOL_SERVER}/`);

export const listDefaultTools = (): McpTool[] =>
  defaultToolEntries.map((entry) => ({
    server: DEFAULT_TOOL_SERVER,
    name: entry.name,
    description: entry.description,
    inputSchema: entry.inputSchema,
  }));

export const getDefaultTool = (name: string) => defaultToolMap.get(name);

export const executeDefaultTool = async (
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> => {
  const entry = getDefaultTool(name);
  if (!entry) {
    return {
      server: DEFAULT_TOOL_SERVER,
      tool: name,
      isError: true,
      content: `Unknown default tool: ${name}`,
    };
  }

  try {
    const content = await entry.execute(args);
    return { server: DEFAULT_TOOL_SERVER, tool: name, isError: false, content };
  } catch (error) {
    return {
      server: DEFAULT_TOOL_SERVER,
      tool: name,
      isError: true,
      content: error instanceof Error ? error.message : String(error),
    };
  }
};

export const defaultAiTools = Object.fromEntries(
  defaultToolEntries.map((entry) => [entry.name, entry.tool]),
);

export { askQuestionTool, createPlanTool, DEFAULT_TOOL_SERVER };
