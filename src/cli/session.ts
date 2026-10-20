import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CapabilityKind, CapabilitySelection, CliOutput, Fl0wMessage } from '../models/agent';
import { SessionStore } from '../db/session-store';
import { applyCapabilitySelection, emptyCapabilitySelection } from '../services/agent/capabilities';
import { fl0wLoop } from '../services/agent/main-loop';
import { findPendingAskQuestion, formatAskQuestionAnswers, type QuestionAnswer } from '../services/agent/utils/ask-question-state';
import { createTranscriptPrinter } from './cli-output';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { scheduleSessionPush } from '../services/sync/session-sync';

const USAGE =
  'Usage: fl0w session [session-id] [--input "<message>"] [--answers \'{"<question-id>":{"optionId":"<option-id>"}}\'] [--capabilities \'{"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}\'] [--messages <path.json>] [--remote]';

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

const parseAnswersJson = (raw: string): Record<string, QuestionAnswer> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const answers: Record<string, QuestionAnswer> = {};
  for (const [questionId, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object') return null;
    const { optionId, customText } = value as Record<string, unknown>;
    if (optionId !== undefined && typeof optionId !== 'string') return null;
    if (customText !== undefined && typeof customText !== 'string') return null;
    // free text without an option is an "Other" answer, matching the TUI's question box
    answers[questionId] = { optionId: optionId ?? 'other', customText: customText ?? '' };
  }
  return answers;
};

export const runSessionCommand = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      capabilities: { type: 'string', short: 'c' },
      answers: { type: 'string', short: 'a' },
      messages: { type: 'string', short: 'm' },
      remote: { type: 'boolean', default: false },
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

  let answers: Record<string, QuestionAnswer> | null = null;
  if (values.answers) {
    answers = parseAnswersJson(values.answers);
    if (!answers) {
      console.error('Invalid --answers JSON: expected {"<question-id>": {"optionId"?: string, "customText"?: string}}');
      return 1;
    }
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
  const store = SessionStore.open();
  const workspace = resolve(process.cwd());

  let session = sessionIdArg
    ? store.listAllSessions().find((entry) => entry.id === sessionIdArg)
    : undefined;
  if (!session) {
    session = remote
      ? { ...store.createDraftSession(workspace), ...(sessionIdArg ? { id: sessionIdArg } : {}) }
      : store.createSession(workspace, sessionIdArg);
  }

  const saved = messagesFromCli ?? (store.hasSession(session.id) ? store.loadMessages(session.id) : []);
  const pendingAsk = findPendingAskQuestion(saved);
  if (answers && !pendingAsk) {
    console.error('--answers given but the session has no pending question');
    return 1;
  }
  if (!input && !answers && saved.length === 0) {
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
  if (capabilitiesFromCli && !remote) store.saveCapabilities(session.id, capabilities);

  // a pending question is answered with its tool-result (as the TUI's question box does), otherwise the loop stops
  // on it again; without --answers, --input is the free-text answer
  const inputIsAnswer = Boolean(pendingAsk && !answers && input);
  const answerText = pendingAsk && answers ? formatAskQuestionAnswers(pendingAsk.input.questions, answers) : inputIsAnswer ? input : null;
  const nextMessages: Fl0wMessage[] = [];
  if (pendingAsk && answerText !== null) {
    nextMessages.push(fl0wMessage({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: pendingAsk.toolCallId,
        toolName: 'AskQuestion',
        output: { type: 'text', value: answerText },
      }],
    }));
  }
  if (input && !inputIsAnswer) nextMessages.push(fl0wMessage({ role: 'user', content: input }));

  const seed = await applyCapabilitySelection(capabilities);
  const messages: Fl0wMessage[] = [...seed, ...saved, ...nextMessages];

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

  const outcome = await fl0wLoop(messages, onMessages, abort.signal);
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
