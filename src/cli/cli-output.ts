import type { CliOuputStatus, CliOutput, Fl0wMessage, SubagentType } from '../models/agent';
import type { ModelSelection } from '../models/ai-model';
import { findPendingAskQuestion } from '../services/agent/utils/ask-question';
import { llmLoop } from '../services/agent/llm-loop';
import { modelStore } from '../store/model-store';

const printLine = (line: CliOutput) => console.log(JSON.stringify(line));

export const createTranscriptPrinter = () => {
  let printed: Fl0wMessage[] | null = null;
  return (all: Fl0wMessage[]) => {
    const conversation = all.filter(({ message }) => message.role !== 'system');
    const rewritten = !printed
      || conversation.length < printed.length
      || printed.some((entry, index) => entry !== conversation[index]);
    if (rewritten) printLine({ type: 'snapshot', messages: conversation });
    else for (let index = printed!.length; index < conversation.length; index++) printLine({ type: 'message', index, message: conversation[index]! });
    printed = conversation;
  };
};

export const createStreamPrinter = () => {
  let streamed = '';
  return (text: string | null) => {
    if (text === null || !text.startsWith(streamed)) {
      if (streamed) printLine({ type: 'stream_end' });
      streamed = '';
      if (text === null) return;
    }
    if (text.length > streamed.length) printLine({ type: 'stream_delta', delta: text.slice(streamed.length) });
    streamed = text;
  };
};

export const createPhasePrinter = () => {
  let current: SubagentType | null = null;
  return (subagent: SubagentType | null) => {
    if (subagent === current) return;
    current = subagent;
    printLine({ type: 'phase', subagent });
  };
};

/**
 * Runs one headless turn the way the TUI's App does, printing what App keeps in state instead: the transcript
 * (`setMessages`), the live text preview (`setStreamingText`) and the running subagent (`setActivePhase`), then the
 * `result` line. `onMessages` lets the caller persist each update.
 */
export const runHeadlessTurn = async ({ messages, models, sessionId, onMessages }: {
  messages: Fl0wMessage[];
  models: ModelSelection | null;
  sessionId: string;
  onMessages?: (messages: Fl0wMessage[]) => void;
}): Promise<CliOuputStatus> => {
  let latest = messages;
  const printTranscript = createTranscriptPrinter();
  printTranscript(messages);

  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());
  process.on('SIGTERM', () => abort.abort());

  await modelStore.loadModels();
  const run = await llmLoop(messages, models, (next) => {
    latest = next;
    printTranscript(next);
    onMessages?.(next);
  }, abort.signal, createStreamPrinter(), createPhasePrinter());
  const outcome = await Promise.resolve(run.finishReason).then(
    (reason) => (reason === 'error' ? 'error' : 'ok'),
    () => 'error' as const,
  );
  onMessages?.(latest);

  const pendingQuestion = findPendingAskQuestion(latest);
  const status = pendingQuestion ? 'needs_input' : abort.signal.aborted ? 'stopped' : outcome;
  printLine({ type: 'result', status, sessionId, ...(pendingQuestion && { pendingQuestion }) });
  return status;
};
