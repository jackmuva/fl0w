import { streamText } from "ai";
import { MAX_ITERATIONS } from "../../constants";
import type { Fl0wMessage } from "../../models/agent";
import { toModelMessages } from "./utils/fl0w-message";

export const llmLoop = async (messages: Fl0wMessage[], setMessages: (messages: Fl0wMessage[]) => void, abort: AbortSignal, onStreamText: (text: string) => void, sessionId: string) => {

}

const explorePhase = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void) => {
  let step = 0;
  while (step < MAX_ITERATIONS) {
    const { textStream } = streamText({
      model: "anthropic/claude-opus-5.5",
      messages: toModelMessages(messages),
    });

    for await (const textPart of textStream) {
      onStreamText(textPart);
    }
  }
}

const planPhase = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void) => {
  let step = 0;
  while (step < MAX_ITERATIONS) {
    const { textStream } = streamText({
      model: "anthropic/claude-opus-5.5",
      messages: toModelMessages(messages),
    });

    for await (const textPart of textStream) {
      onStreamText(textPart);
    }
  }
}

const executePhase = async (messages: Fl0wMessage[], abort: AbortSignal, onStreamText: (text: string) => void) => {
  let step = 0;
  while (step < MAX_ITERATIONS) {
    const { textStream } = streamText({
      model: "anthropic/claude-opus-5.5",
      messages: toModelMessages(messages),
    });

    for await (const textPart of textStream) {
      onStreamText(textPart);
    }
  }
}
