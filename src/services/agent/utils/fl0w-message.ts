import type { ModelMessage } from 'ai';
import type { ChoiceProbabilities, Fl0wMessage, Fl0wMessageFrame } from '../../../models/agent';

export type DecisionMessagePayload = {
  selectedTool: string;
  probabilities: ChoiceProbabilities;
};

const LLM_EXCLUDED_FRAMES = new Set<Fl0wMessageFrame>(['decision']);

export const fl0wMessage = (
  message: ModelMessage,
  frame?: Fl0wMessageFrame,
): Fl0wMessage => ({
  message,
  ...(frame && { frame }),
});

export const decisionMessage = (
  probabilities: ChoiceProbabilities,
  selectedTool: string,
): Fl0wMessage =>
  fl0wMessage(
    {
      role: 'assistant',
      content: JSON.stringify({ selectedTool, probabilities } satisfies DecisionMessagePayload),
    },
    'decision',
  );

export const appendDecisionMessage = (
  messages: Fl0wMessage[],
  probabilities: ChoiceProbabilities,
  selectedTool: string,
): Fl0wMessage[] => {
  const last = messages.at(-1);
  if (last?.frame === 'decision') {
    const parsed = parseDecisionMessage(last);
    if (parsed?.selectedTool === selectedTool) return messages;
  }
  return [...messages, decisionMessage(probabilities, selectedTool)];
};

export const parseDecisionMessage = (entry: Fl0wMessage): DecisionMessagePayload | null => {
  if (entry.frame !== 'decision') return null;
  const { content } = entry.message;
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content) as DecisionMessagePayload;
    if (!parsed || typeof parsed.selectedTool !== 'string' || !parsed.probabilities) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const toModelMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  const included = messages.filter(({ frame }) => !frame || !LLM_EXCLUDED_FRAMES.has(frame));
  const system = included.filter(({ message }) => message.role === 'system');
  const summaries = included.filter(({ frame }) => frame === 'summary');
  const rest = included.filter(
    ({ message, frame }) => message.role !== 'system' && frame !== 'summary',
  );
  return [...system, ...summaries, ...rest].map(({ message }) => message);
};
