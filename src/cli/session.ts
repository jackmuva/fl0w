import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CapabilityKind, CapabilitySelection, Fl0wMessage } from '../models/agent';
import { SessionStore } from '../db/session-store';
import { applyCapabilitySelection, emptyCapabilitySelection } from '../services/agent/capabilities';
import { fl0wLoop } from '../services/agent/agent-loop';
import { findPendingAskQuestion } from '../services/agent/utils/ask-question-state';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { scheduleSessionPush } from '../services/sync/session-sync';

const HEADLESS_INSTRUCTIONS = [
  'You are running unattended: no human is available to answer questions.',
  'Do not ask clarifying or follow-up questions. When something is ambiguous, make the most reasonable assumption,',
  'state it in your output, and continue executing the workflow to completion.',
].join(' ');

const USAGE =
  'Usage: fl0w session [session-id] [--input "<message>"] [--capabilities \'{"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}\']';

const CAPABILITY_KINDS: CapabilityKind[] = ['skills', 'mcpServers', 'userTools', 'agentsMd'];

const parseCapabilitiesJson = (raw: string): CapabilitySelection | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  for (const kind of CAPABILITY_KINDS) {
    const value = obj[kind];
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null;
  }
  return {
    skills: obj.skills as string[],
    mcpServers: obj.mcpServers as string[],
    userTools: obj.userTools as string[],
    agentsMd: obj.agentsMd as string[],
  };
};

/** Runs or continues a saved session without the TUI. Streams JSON lines to stdout. */
export const runSessionCommand = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      capabilities: { type: 'string', short: 'c' },
    },
    allowPositionals: true,
    strict: true,
  });

  const sessionIdArg = positionals[0];
  const input = values.input?.trim() ?? '';

  let capabilitiesFromCli: CapabilitySelection | null = null;
  if (values.capabilities) {
    capabilitiesFromCli = parseCapabilitiesJson(values.capabilities);
    if (!capabilitiesFromCli) {
      console.error('Invalid --capabilities JSON: expected CapabilitySelection with string arrays for skills, mcpServers, userTools, agentsMd');
      return 1;
    }
  }

  const store = SessionStore.open();
  const workspace = resolve(process.cwd());

  let session = sessionIdArg
    ? store.listAllSessions().find((entry) => entry.id === sessionIdArg)
    : undefined;
  if (sessionIdArg && !session) {
    console.error(`Session not found: ${sessionIdArg}`);
    return 1;
  }
  if (!session) session = store.createSession(workspace);

  const saved = store.loadMessages(session.id);
  if (!input && saved.length === 0) {
    console.error(`${USAGE}\n--input is required for a new or empty session`);
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

  const capabilities = capabilitiesFromCli
    ?? store.getCapabilities(session.id)
    ?? emptyCapabilitySelection();
  if (capabilitiesFromCli) store.saveCapabilities(session.id, capabilities);

  const seed = await applyCapabilitySelection(capabilities);
  const messages: Fl0wMessage[] = [
    ...seed,
    ...saved,
    fl0wMessage({ role: 'system', content: HEADLESS_INSTRUCTIONS }),
    ...(input ? [fl0wMessage({ role: 'user', content: input })] : []),
  ];

  let latest = messages;
  let printed = messages.length;
  const onMessages = (next: Fl0wMessage[]) => {
    latest = next;
    if (next.length < printed) printed = next.length;
    for (const { message } of next.slice(printed)) console.log(JSON.stringify({ type: 'message', message }));
    printed = next.length;
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
  console.log(JSON.stringify({
    type: 'result',
    status,
    sessionId: session.id,
    finalMessage,
    ...(pendingQuestion && { pendingQuestion }),
  }));

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};
