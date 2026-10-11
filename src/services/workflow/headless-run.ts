import { parseArgs } from 'node:util';
import type { JevMessage } from '../../models/agent';
import type { WorkflowRecord } from '../../models/workflow';
import { WorkflowStore } from '../../db/workflow-store';
import { applyCapabilitySelection } from '../agent/capabilities';
import { jevLoop } from '../agent/agent-loop';
import { findPendingAskQuestion } from '../agent/utils/ask-question-state';
import { jevMessage } from '../agent/utils/jev-message';
import { loadUserTools } from '../agent/user-tools/loader';
import { mcpClient } from '../mcp/mcp-client';
import { buildWorkflowUserMessage } from './build-message';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE = 'Usage: fl0w run --workflow <path.json | workflow-id> [--input "<extra instructions>"]';

/** Runs a saved workflow without the TUI. Streams JSON lines to stdout and returns the exit code. */
export const runHeadless = async (argv: string[]): Promise<number> => {
  const { values } = parseArgs({
    args: argv,
    options: {
      workflow: { type: 'string', short: 'w' },
      input: { type: 'string', short: 'i' },
    },
    strict: true,
  });
  if (!values.workflow) {
    console.error(USAGE);
    return 1;
  }

  const workflowFile = Bun.file(values.workflow);
  const workflow: WorkflowRecord | null = (await workflowFile.exists())
    ? await workflowFile.json() as WorkflowRecord
    : WorkflowStore.open().getWorkflow(values.workflow);
  if (!workflow) {
    console.error(`Workflow not found: ${values.workflow}`);
    return 1;
  }

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
  const messages: JevMessage[] = [
    ...seed,
    jevMessage({ role: 'system', content: HEADLESS_INSTRUCTIONS }),
    jevMessage(buildWorkflowUserMessage(workflow, values.input ?? '')),
  ];

  let latest = messages;
  // seed messages are known to the caller; only stream what the run adds
  let printed = messages.length;
  const onMessages = (next: JevMessage[]) => {
    latest = next;
    // compaction can shrink the transcript; don't re-print what was rewritten
    if (next.length < printed) printed = next.length;
    for (const { message } of next.slice(printed)) console.log(JSON.stringify({ type: 'message', message }));
    printed = next.length;
  };

  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());
  process.on('SIGTERM', () => abort.abort());

  const outcome = await jevLoop(messages, onMessages, { signal: abort.signal });
  const pendingQuestion = findPendingAskQuestion(latest);
  const status = pendingQuestion ? 'needs_input' : outcome;
  const last = latest.at(-1)?.message;
  const finalMessage = typeof last?.content === 'string' ? last.content : undefined;
  console.log(JSON.stringify({ type: 'result', status, finalMessage, ...(pendingQuestion && { pendingQuestion }) }));

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};
