import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CliOutput, Fl0wMessage } from '../models/agent';
import type { WorkflowRecord } from '../models/workflow';
import { WorkflowStore } from '../db/workflow-store';
import { SessionStore } from '../db/session-store';
import { applyCapabilitySelection } from '../services/agent/capabilities';
import { fl0wLoop } from '../services/agent/main-loop';
import { findPendingAskQuestion } from '../services/agent/utils/ask-question-state';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { scheduleSessionPush } from '../services/sync/session-sync';
import { buildWorkflowUserMessage } from '../services/workflow/build-message';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE =
  'Usage: fl0w workflow <path.json | workflow-id> [--input "<extra instructions>"] [--session <session-id>]';

/** Runs a saved workflow without the TUI. Streams JSON lines to stdout and returns the exit code. */
export const runWorkflowCommand = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      session: { type: 'string', short: 's' },
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

  const store = SessionStore.open();
  const workspace = resolve(process.cwd());
  const sessionIdArg = values.session?.trim() || undefined;

  let session = sessionIdArg
    ? store.listAllSessions().find((entry) => entry.id === sessionIdArg)
    : undefined;
  if (!session) session = store.createSession(workspace, sessionIdArg);

  const saved = sessionIdArg ? store.loadMessages(session.id) : [];
  store.saveCapabilities(session.id, workflow.requiredCapabilities);

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
  let printed = messages.length;
  const onMessages = (next: Fl0wMessage[]) => {
    latest = next;
    // compaction can shrink the transcript; don't re-print what was rewritten
    if (next.length < printed) printed = next.length;
    for (const { message } of next.slice(printed)) {
      const line: CliOutput = { type: 'message', message };
      console.log(JSON.stringify(line));
    }
    printed = next.length;
    store.saveMessages(session.id, next);
    scheduleSessionPush(store);
  };

  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());
  process.on('SIGTERM', () => abort.abort());

  const outcome = await fl0wLoop(messages, onMessages, abort.signal);
  store.saveMessages(session.id, latest);
  scheduleSessionPush(store);

  const pendingQuestion = findPendingAskQuestion(latest);
  const status = pendingQuestion ? 'needs_input' : outcome;
  const last = latest.at(-1)?.message;
  const finalMessage = typeof last?.content === 'string' ? last.content : undefined;
  const result: CliOutput = {
    type: 'result',
    status,
    sessionId: session.id,
    finalMessage,
    ...(pendingQuestion && { pendingQuestion }),
  };
  console.log(JSON.stringify(result));

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};
