import { generateText, type ModelMessage } from 'ai';
import {
  COMPACTION_CONTEXT_WINDOW,
  COMPACTION_TOKEN_THRESHOLD,
  LLM_MODEL,
  TOOL_RESULT_MIN_KEEP,
  TOOL_TRUNCATE_STEPS,
} from '../../../constants';
import { recordLlmUsage } from './session-usage';
import type { AgentState, JevMessage } from '../../../models/agent';
import { jevMessage } from '../utils/jev-message';

export type CompactionOptions = {
  keepAssistantMessages?: number;
  contextWindow?: number;
  tokenThreshold?: number;
};

const DEFAULT_OPTIONS: Required<CompactionOptions> = {
  keepAssistantMessages: 4,
  contextWindow: COMPACTION_CONTEXT_WINDOW,
  tokenThreshold: COMPACTION_TOKEN_THRESHOLD,
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

type MessageTextOptions = {
  truncateToolResults?: number;
};

const messageToText = (message: ModelMessage, options: MessageTextOptions = {}): string => {
  const prefix = `${message.role}: `;
  if (typeof message.content === 'string') {
    return prefix + message.content;
  }

  const parts = message.content.map((part) => {
    switch (part.type) {
      case 'text':
      case 'reasoning':
        return part.text;
      case 'tool-call':
        return `[tool call: ${part.toolName}(${JSON.stringify(part.input)})]`;
      case 'tool-result':
        if ('value' in part.output) {
          const value = part.output.value;
          const text = typeof value === 'string' ? value : JSON.stringify(value);
          const payload = options.truncateToolResults != null
            ? truncate(text, options.truncateToolResults)
            : text;
          return `[tool result: ${part.toolName}: ${payload}]`;
        }
        return `[tool result: ${part.toolName}: ${part.output.type}]`;
      default:
        return `[${part.type}]`;
    }
  });

  return prefix + parts.join('\n');
};

export const estimateTextTokens = (text: string): number =>
  Math.ceil(text.length / 3);

const estimateMessageTokens = ({ message }: JevMessage): number =>
  estimateTextTokens(messageToText(message));

export const estimateMessagesTokens = (messages: JevMessage[]): number =>
  messages.reduce((total, message) => total + estimateMessageTokens(message), 0);

const truncateToolResultParts = (message: ModelMessage, maxChars: number): ModelMessage => {
  if (message.role === 'assistant' && typeof message.content === 'string') {
    if (message.content.length <= maxChars) return message;
    return { ...message, content: truncate(message.content, maxChars) };
  }
  if (message.role !== 'tool' && message.role !== 'assistant') return message;
  if (!Array.isArray(message.content)) return message;

  let changed = false;
  const content = message.content.map((part) => {
    if (part.type !== 'tool-result' || !('value' in part.output)) return part;

    const { output } = part;
    let text: string | undefined;
    if (output.type === 'text' || output.type === 'error-text') {
      text = output.value;
    } else if (output.type === 'json' || output.type === 'error-json') {
      text = typeof output.value === 'string' ? output.value : JSON.stringify(output.value);
    } else if (output.type === 'content') {
      text = output.value
        .map((item) => (item.type === 'text' ? item.text : `[${item.type}]`))
        .join('\n');
    } else {
      return part;
    }

    if (text.length <= maxChars) return part;
    changed = true;
    const keep = Math.max(maxChars, TOOL_RESULT_MIN_KEEP);
    const nextValue = truncate(text, keep);
    if (output.type === 'text' || output.type === 'error-text') {
      return { ...part, output: { ...output, value: nextValue } };
    }
    // json / error-json / content: keep a plain string so providers never see partial JSON or a broken content array.
    return { ...part, output: { type: 'text', value: nextValue } };
  });

  return changed ? { ...message, content } as ModelMessage : message;
};

const getToolMessageIndicesOldestFirst = (messages: JevMessage[]): number[] =>
  messages
    .map((entry, index) => (entry.message.role === 'tool' ? index : -1))
    .filter((index) => index >= 0);

const applyToolResultCharLimits = (
  messages: JevMessage[],
  limitsByIndex: Map<number, number>,
): JevMessage[] =>
  messages.map((entry, index) => {
    const limit = limitsByIndex.get(index);
    if (limit == null) return entry;
    const message = truncateToolResultParts(entry.message, limit);
    return message === entry.message ? entry : { ...entry, message };
  });

export const shrinkMessagesToTokenBudget = (
  messages: JevMessage[],
  tokenLimit: number,
): JevMessage[] => {
  if (estimateMessagesTokens(messages) <= tokenLimit) return messages;

  const toolIndices = getToolMessageIndicesOldestFirst(messages);
  if (toolIndices.length === 0) return messages;

  const limitsByIndex = new Map<number, number>();
  let current = messages;

  const shrinkIndicesInOrder = (indices: number[]) => {
    for (const step of TOOL_TRUNCATE_STEPS) {
      if (estimateMessagesTokens(current) <= tokenLimit) return;
      for (const index of indices) {
        if (estimateMessagesTokens(current) <= tokenLimit) return;
        const previous = limitsByIndex.get(index) ?? Number.POSITIVE_INFINITY;
        limitsByIndex.set(index, Math.min(previous, step));
        current = applyToolResultCharLimits(current, limitsByIndex);
      }
    }
  };

  const olderToolIndices = toolIndices.slice(0, -1);
  const latestToolIndex = toolIndices.at(-1);

  shrinkIndicesInOrder(olderToolIndices);
  if (estimateMessagesTokens(current) > tokenLimit && latestToolIndex != null) {
    shrinkIndicesInOrder([latestToolIndex]);
  }

  return current;
};

const getRetainedIndices = (
  messages: JevMessage[],
  keepAssistantCount: number,
): Set<number> => {
  const retained = new Set<number>();

  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.message.role === 'system') retained.add(i);
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]?.message;
    if (message?.role === 'user') {
      retained.add(i);
      break;
    }
  }

  let count = 0;
  for (let i = messages.length - 1; i >= 0 && count < keepAssistantCount; i--) {
    const message = messages[i]?.message;
    if (!message) continue;
    if (message.role === 'assistant' || message.role === 'tool') {
      retained.add(i);
      count++;
    }
  }

  return retained;
};

export const compactMessages = async (
  messages: JevMessage[],
  force: boolean = false,
  options: CompactionOptions = {},
): Promise<JevMessage[]> => {
  const { keepAssistantMessages, contextWindow, tokenThreshold } = { ...DEFAULT_OPTIONS, ...options, };
  const tokenLimit = contextWindow * tokenThreshold;

  if (estimateMessagesTokens(messages) < tokenLimit && !force) return messages;

  const retained = getRetainedIndices(messages, keepAssistantMessages);
  const toSummarize = messages.filter((_, index) => !retained.has(index));

  let result = messages;

  if (toSummarize.length > 0) {
    const transcript = toSummarize.map(({ message }) => messageToText(message, { truncateToolResults: 2_000 }))
      .join('\n\n');
    const summaryResult = await generateText({
      model: LLM_MODEL,
      instructions:
        `Summarize the following conversation history concisely. Preserve the user's goal, key decisions, important tool results, and progress made. Omit redundant details.\n\n` +
        `Important: Keep the summary compact — it must be significantly shorter than the compaction context window of ${contextWindow} tokens. That window is used at a threshold of ${Math.round(tokenThreshold * 100)}% (i.e. a budget of ${tokenLimit} tokens), and the summary is re-fed into the model alongside other retained messages. So it must comfortably fit within that limit. Optimize for a tight, information-dense summary — favor the user's goal, key decisions, important tool results, and progress over verbatim detail.`,
      prompt: transcript,
    });
    recordLlmUsage(summaryResult);
    const { text: summary } = summaryResult;

    const summaryMessage = jevMessage(
      { role: 'assistant', content: summary },
      'summary',
    );

    const kept = messages.filter((_, index) => retained.has(index));
    const systemMessages = kept.filter(({ message }) => message.role === 'system');
    const otherKept = kept.filter(
      ({ message, frame }) => message.role !== 'system' && frame !== 'summary',
    );
    // Append summary last so sticky bottom scroll shows it; LLM order is restored in toModelMessages.
    result = [...systemMessages, ...otherKept, summaryMessage];
  }

  const shrunk = shrinkMessagesToTokenBudget(result, tokenLimit);
  return shrunk === result && result === messages ? messages : shrunk;
};

export const compactionHook = async (state: AgentState, force: boolean = false): Promise<AgentState> => {
  const messages = await compactMessages(state.messages, force);
  return messages === state.messages ? state : { ...state, messages };
};
