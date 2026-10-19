import type { CliOutput, Fl0wMessage } from '../models/agent';

const printLine = (line: CliOutput) => console.log(JSON.stringify(line));

/**
 * Prints the persisted transcript (non-system messages, as `saveMessages` stores them) as replayable JSON lines:
 * a `snapshot` first, then a `message` per appended entry, and a fresh `snapshot` whenever compaction or a rewind
 * shrinks or rewrites already-printed entries. Replaying the lines in order rebuilds the transcript.
 */
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
