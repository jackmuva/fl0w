import type { ModelMessage } from 'ai';
import type { ChoiceProbabilities, JevMessage, JevMessageFrame } from '../../../models/agent';

export type DecisionMessagePayload = {
  selectedTool: string;
  probabilities: ChoiceProbabilities;
};

const LLM_EXCLUDED_FRAMES = new Set<JevMessageFrame>(['decision']);

export const jevMessage = (
  message: ModelMessage,
  frame?: JevMessageFrame,
): JevMessage => ({
  message,
  ...(frame && { frame }),
});

export const decisionMessage = (
  probabilities: ChoiceProbabilities,
  selectedTool: string,
): JevMessage =>
  jevMessage(
    {
      role: 'assistant',
      content: JSON.stringify({ selectedTool, probabilities } satisfies DecisionMessagePayload),
    },
    'decision',
  );

export const appendDecisionMessage = (
  messages: JevMessage[],
  probabilities: ChoiceProbabilities,
  selectedTool: string,
): JevMessage[] => {
  const last = messages.at(-1);
  if (last?.frame === 'decision') {
    const parsed = parseDecisionMessage(last);
    if (parsed?.selectedTool === selectedTool) return messages;
  }
  return [...messages, decisionMessage(probabilities, selectedTool)];
};

export const parseDecisionMessage = (entry: JevMessage): DecisionMessagePayload | null => {
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

export const toModelMessages = (messages: JevMessage[]): ModelMessage[] =>
  messages
    .filter(({ frame }) => !frame || !LLM_EXCLUDED_FRAMES.has(frame))
    .map(({ message }) => message);
