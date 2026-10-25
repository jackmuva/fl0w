import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CliOutput, Fl0wMessage } from '../models/agent';
import type { WorkflowRecord } from '../models/workflow';
import { WorkflowStore } from '../db/workflow-store';
import { SessionStore } from '../db/session-store';
import { applyCapabilitySelection } from '../services/agent/config';
import { findPendingAskQuestion } from '../services/agent/utils/ask-question';
import { createStreamPrinter, createTranscriptPrinter } from './cli-output';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { scheduleSessionPush } from '../services/sync/session-sync';
import { finishHeadlessRun } from '../services/setup';
import { runStartupSync } from '../services/setup';
import { buildWorkflowUserMessage } from '../services/workflow/build-message';
import { llmLoop } from '../services/agent/llm-loop';
import { loadModels } from '../services/model-registry';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE =
  'Usage: fl0w workflow <path.json | workflow-id> [--input "<extra instructions>"] [--session <session-id>] [--messages <path.json>] [--remote]';

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
  const workflowRef = positionals[0];
  if (!workflowRef) {
    console.error(USAGE);
    return 1;
  }

  const workflowFile = Bun.file(workflowRef);
  const workflow: WorkflowRecord | null = (await workflowFile.exists())
    ? await workflowFile.json() as WorkflowRecord
    : WorkflowStore.open().getWorkflow(workflowRef);
  if (!workflow) {
    console.error(`Workflow not found: ${workflowRef}`);
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
  const syncWarning = await runStartupSync({ log: console.error, syncSessions: !remote });
  if (syncWarning) console.error(syncWarning);

  const store = SessionStore.open();
  const workspace = resolve(process.cwd());
  const sessionIdArg = values.session?.trim() || undefined;

  let session = sessionIdArg
    ? store.listAllSessions().find((entry) => entry.id === sessionIdArg)
    : undefined;
  if (!session) {
    session = remote
      ? { ...store.createDraftSession(workspace), ...(sessionIdArg ? { id: sessionIdArg } : {}) }
      : store.createSession(workspace, sessionIdArg);
  }

  const saved = messagesFromCli ?? (sessionIdArg && store.hasSession(session.id) ? store.loadMessages(session.id) : []);
  if (!remote) store.saveCapabilities(session.id, workflow.requiredCapabilities);

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
  ];

  let latest = messages;
  const printTranscript = createTranscriptPrinter();
  printTranscript(messages);
  const onMessages = (next: Fl0wMessage[]) => {
    latest = next;
    printTranscript(next);
    if (!remote) {
      store.saveMessages(session.id, next);
      scheduleSessionPush(store);
    }
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
  if (!remote) {
    store.saveMessages(session.id, latest);
    scheduleSessionPush(store);
  }

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
