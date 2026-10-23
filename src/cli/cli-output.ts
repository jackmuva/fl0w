import type { CliOutput, Fl0wMessage } from '../models/agent';

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
