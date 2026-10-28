import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CapabilityKind, CapabilitySelection, Fl0wMessage, ModelSelection } from '../models/agent';
import type { SessionRecord } from '../models/session';
import { createDraftSession, emptyModelSelection } from '../services/service-utils';
import { applyCapabilitySelection, emptyCapabilitySelection } from '../services/capabilities';
import { findPendingAskQuestion, formatAskQuestionAnswers, type QuestionAnswer } from '../services/agent/utils/question-utils';
import { runHeadlessTurn } from './cli-output';
import { fl0wMessage } from '../services/agent/utils/message-utils';
import { userToolLoader } from '../services/external-tools/user-tool-service';
import { mcpClient } from '../services/external-tools/mcp-client';
import { finishHeadlessRun } from '../services/setup';
import { requireLogin, runStartupSync } from '../services/setup';

const USAGE = 'Usage: fl0w session [session-id] [--input "<message>"] [--answers \'{"<question-id>":{"optionId":"<option-id>"}}\'] [--capabilities \'{"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}\'] [--models \'{"EXECUTE":"<model>"}\'] [--messages <path.json>]';

const CAPABILITY_KINDS: CapabilityKind[] = ['skills', 'mcpServers', 'userTools', 'agentsMd'];

const MODEL_PHASES = Object.keys(emptyModelSelection()) as (keyof ModelSelection)[];

const parseModelsJson = (raw: string): Partial<ModelSelection> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const models: Partial<ModelSelection> = {};
  for (const [phase, model] of Object.entries(parsed)) {
    if (!MODEL_PHASES.includes(phase as keyof ModelSelection) || typeof model !== 'string') return null;
    models[phase as keyof ModelSelection] = model;
  }
  return models;
};



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
      models: { type: 'string' },
      answers: { type: 'string', short: 'a' },
      messages: { type: 'string', short: 'm' },
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

  let modelsFromCli: Partial<ModelSelection> | null = null;
  if (values.models) {
    modelsFromCli = parseModelsJson(values.models);
    if (!modelsFromCli) {
      console.error('Invalid --models JSON: expected {"<phase>": "<model>"} with phases ROUTER, DISCOVERY, PLAN, EXECUTE');
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
      console.error(`Invalid --messages file: expected a JSON array of {"message":{...},"subagent"?:...} at ${values.messages}`);
      return 1;
    }
  }

  if (!(await requireLogin())) return 1;
  const syncWarning = await runStartupSync({ log: console.error });
  if (syncWarning) console.error(syncWarning);

  const workspace = resolve(process.cwd());

  // Headless runs are recorded by fl0w-work itself, which passes the transcript with --messages
  let session: SessionRecord = createDraftSession(workspace, sessionIdArg);

  const saved = messagesFromCli ?? [];
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
  await userToolLoader.loadUserTools();

  const capabilities = capabilitiesFromCli
    ?? session.capabilities
    ?? emptyCapabilitySelection();
  // saved with the session's next save
  if (capabilitiesFromCli) session = { ...session, capabilities };
  if (modelsFromCli) session = { ...session, models: { ...(session.models ?? emptyModelSelection()), ...modelsFromCli } };

  const inputIsAnswer = Boolean(pendingAsk && !answers && input);
  const answerText = pendingAsk && answers ? formatAskQuestionAnswers(pendingAsk.input.questions, answers) : inputIsAnswer ? input : null;
  const nextMessages: Fl0wMessage[] = [];
  if (pendingAsk && answerText !== null) {
    nextMessages.push(fl0wMessage({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: pendingAsk.toolCallId,
        toolName: pendingAsk.toolName,
        output: { type: 'text', value: answerText },
      }],
    }));
  }
  if (input && !inputIsAnswer) nextMessages.push(fl0wMessage({ role: 'user', content: input }));

  const seed = await applyCapabilitySelection(capabilities);
  const messages: Fl0wMessage[] = [...seed, ...saved, ...nextMessages];

  const status = await runHeadlessTurn({
    messages,
    models: session.models,
    sessionId: session.id,
  });

  await mcpClient.close();
  if (status === 'ok') return 0;
  return status === 'needs_input' ? 2 : 1;
};

export const runSessionCli = async (argv: string[]): Promise<number> => finishHeadlessRun(await runSessionCommand(argv));
