import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { Fl0wMessage } from '../models/agent';
import type { WorkflowRecord } from '../models/workflow';
import type { SessionRecord } from '../models/session';
import { createDraftSession, emptyModelSelection } from '../services/service-utils';
import { getWorkflow } from '../store/workflow-store';
import { applyCapabilitySelection } from '../services/capabilities';
import { runHeadlessTurn } from './cli-output';
import { fl0wMessage } from '../services/agent/utils/message-utils';
import { userToolLoader } from '../services/external-tools/user-tool-service';
import { mcpClient } from '../services/external-tools/mcp-client';
import { finishHeadlessRun } from '../services/setup';
import { requireLogin, runStartupSync } from '../services/setup';
import { buildWorkflowPlanMessages, buildWorkflowUserMessage } from '../services/workflow/build-message';
import { activeWorkflowStore } from '../store/active-workflow-store';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE =
  'Usage: fl0w workflow <workflow-id> [--input "<extra instructions>"] [--session <session-id>] [--messages <path.json>]';

export const runWorkflowCommand = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      session: { type: 'string', short: 's' },
      messages: { type: 'string', short: 'm' },
    },
    allowPositionals: true,
    strict: true,
  });
  const workflowId = positionals[0];
  if (!workflowId) {
    console.error(USAGE);
    return 1;
  }

  if (!(await requireLogin())) return 1;

  let workflow: WorkflowRecord | null;
  try {
    workflow = await getWorkflow(workflowId);
  } catch (error) {
    console.error(`Could not load workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (!workflow) {
    console.error(`Workflow not found: ${workflowId}`);
    return 1;
  }

  let messagesFromCli: Fl0wMessage[] | null = null;
  if (values.messages) {
    messagesFromCli = await Bun.file(values.messages).json().catch(() => null) as Fl0wMessage[] | null;
    if (!Array.isArray(messagesFromCli)) {
      console.error(`Invalid --messages file: expected a JSON array of {"message":{...},"subagent"?:...} at ${values.messages}`);
      return 1;
    }
  }

  const syncWarning = await runStartupSync({ log: console.error });
  if (syncWarning) console.error(syncWarning);

  const workspace = resolve(process.cwd());
  const sessionIdArg = values.session?.trim() || undefined;

  // Headless runs are recorded by fl0w-work itself, which passes the transcript with --messages
  const base = createDraftSession(workspace, sessionIdArg);
  const session: SessionRecord = {
    ...base,
    capabilities: workflow.requiredCapabilities,
    models: workflow.models ?? base.models ?? emptyModelSelection(),
  };

  const saved = messagesFromCli ?? [];

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

  const seed = await applyCapabilitySelection(workflow.requiredCapabilities);
  const messages: Fl0wMessage[] = [
    ...seed,
    ...saved,
    fl0wMessage({ role: 'system', content: HEADLESS_INSTRUCTIONS }),
    fl0wMessage(buildWorkflowUserMessage(workflow, values.input ?? '')),
    ...buildWorkflowPlanMessages(workflow).map((message) => fl0wMessage(message)),
  ];
  // set after applyCapabilitySelection so the seeded front-load messages don't capture it; agentLoop clears it
  activeWorkflowStore.set(workflow, values.input ?? '');

  const status = await runHeadlessTurn({
    messages,
    models: session.models,
    sessionId: session.id,
  });

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};

export const runWorkflowCli = async (argv: string[]): Promise<number> =>
  finishHeadlessRun(await runWorkflowCommand(argv));
