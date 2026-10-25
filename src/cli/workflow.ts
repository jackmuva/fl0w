import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CliOutput, Fl0wMessage } from '../models/agent';
import type { WorkflowRecord } from '../models/workflow';
import type { SessionRecord, StoredSession } from '../models/session';
import { getSession, saveSession } from '../services/session/session-repo';
import { createDraftSession } from '../services/session/session-record';
import { getWorkflow } from '../services/workflow/workflow-repo';
import { applyCapabilitySelection } from '../services/agent/config';
import { findPendingAskQuestion } from '../services/agent/utils/ask-question';
import { createStreamPrinter, createTranscriptPrinter } from './cli-output';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { finishHeadlessRun } from '../services/setup';
import { requireLogin, runStartupSync } from '../services/setup';
import { buildWorkflowPlanMessages, buildWorkflowUserMessage } from '../services/workflow/build-message';
import { setActiveWorkflow } from '../services/agent/hooks/front-load';
import { llmLoop } from '../services/agent/llm-loop';
import { loadModels } from '../services/model-registry';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE =
  'Usage: fl0w workflow <workflow-id> [--input "<extra instructions>"] [--session <session-id>] [--messages <path.json>] [--remote]';

/** Runs a saved workflow without the TUI. Streams JSON lines to stdout and returns the exit code. */
export const runWorkflowCommand = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      session: { type: 'string', short: 's' },
      messages: { type: 'string', short: 'm' },
      remote: { type: 'boolean', default: false },
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
      console.error(`Invalid --messages file: expected a JSON array of {"message":{...},"frame"?:...} at ${values.messages}`);
      return 1;
    }
  }

  const remote = values.remote === true;
  const syncWarning = await runStartupSync({ log: console.error });
  if (syncWarning) console.error(syncWarning);

  const workspace = resolve(process.cwd());
  const sessionIdArg = values.session?.trim() || undefined;

  // --remote runs are recorded by fl0w-work itself, which passes the transcript with --messages
  let stored: StoredSession | null = null;
  if (sessionIdArg && !remote) {
    try {
      stored = await getSession(sessionIdArg);
    } catch (error) {
      console.error(`Could not load session ${sessionIdArg}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  // the workflow's capabilities are saved with the session's next save
  let session: SessionRecord = { ...(stored ?? createDraftSession(workspace, sessionIdArg)), capabilities: workflow.requiredCapabilities };

  const saved = messagesFromCli ?? stored?.messages ?? [];

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

  const seed = await applyCapabilitySelection(workflow.requiredCapabilities);
  const messages: Fl0wMessage[] = [
    ...seed,
    ...saved,
    fl0wMessage({ role: 'system', content: HEADLESS_INSTRUCTIONS }),
    fl0wMessage(buildWorkflowUserMessage(workflow, values.input ?? '')),
    ...buildWorkflowPlanMessages(workflow).map((message) => fl0wMessage(message)),
  ];
  // set after applyCapabilitySelection so the seeded front-load messages don't capture it; llmLoop clears it
  setActiveWorkflow(workflow, values.input ?? '');

  let latest = messages;
  const printTranscript = createTranscriptPrinter();
  printTranscript(messages);
  const onMessages = (next: Fl0wMessage[]) => {
    latest = next;
    printTranscript(next);
    if (!remote) session = saveSession(session, next);
  };

  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());
  process.on('SIGTERM', () => abort.abort());

  await loadModels();
  const run = await llmLoop(messages, session.models, onMessages, abort.signal, createStreamPrinter());
  const outcome = await Promise.resolve(run.finishReason).then(
    (reason) => (reason === 'error' ? 'error' : 'ok'),
    () => 'error' as const,
  );
  if (!remote) session = saveSession(session, latest);

  const pendingQuestion = findPendingAskQuestion(latest);
  const status = pendingQuestion ? 'needs_input' : abort.signal.aborted ? 'stopped' : outcome;
  const result: CliOutput = {
    type: 'result',
    status,
    sessionId: session.id,
    ...(pendingQuestion && { pendingQuestion }),
  };
  console.log(JSON.stringify(result));

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};

export const runWorkflowCli = async (argv: string[]): Promise<number> =>
  finishHeadlessRun(await runWorkflowCommand(argv));
