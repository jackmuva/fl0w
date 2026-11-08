import type { ModelMessage } from 'ai';
import type { Fl0wMessage, SubagentType } from '../../../models/agent';
import { streamText, type ToolSet } from "ai";
import { MAX_IMAGES_IN_CONTEXT } from '../../../constants';
import { mimeFromExtension } from '../default-tools/tool-utils';

export type AgentResult = ReturnType<typeof streamText<ToolSet>>;

export const fl0wMessage = (
  message: ModelMessage,
  subagent?: SubagentType,
): Fl0wMessage => ({
  message,
  ...(subagent && { subagent }),
});

export const toModelMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  return messages.filter((message) => message.message.role !== "system").map((message) => message.message);
};

const hasText = (message: ModelMessage): boolean => typeof message.content === "string"
  ? message.content.trim().length > 0
  : message.content.some((part) => part.type === "text" && part.text.trim().length > 0);

// Skips tool-call-only assistant steps so the router sees the phase's conclusion, not its last action.
export const findLastUserAndAssistantMessages = (messages: Fl0wMessage[]): ModelMessage[] => {
  let lastUser = -1;
  let lastAssistant = -1;

  for (let i = messages.length - 1; i >= 0 && (lastUser < 0 || lastAssistant < 0); i--) {
    const message = messages[i]?.message;
    if (!message) continue;
    if (lastUser < 0 && message.role === "user") lastUser = i;
    if (lastAssistant < 0 && message.role === "assistant" && hasText(message)) lastAssistant = i;
  }

  return [lastUser, lastAssistant]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
    .map((index) => messages[index]!.message);
};

const IMAGE_MARKER = /\[image:([^\]\n]+)\]/g;
const HAS_IMAGE_MARKER = /\[image:[^\]\n]+\]/;

type ToolResultOutput = Extract<Extract<ModelMessage, { role: 'tool' }>['content'][number], { type: 'tool-result' }>['output'];

const markerText = (output: ToolResultOutput): string | undefined => {
  if (output.type === 'text') return HAS_IMAGE_MARKER.test(output.value) ? output.value : undefined;
  if (output.type !== 'content') return undefined;
  const text = output.value.find((item) => item.type === 'text')?.text;
  return text !== undefined && HAS_IMAGE_MARKER.test(text) ? text : undefined;
};

/**
 * Turns `[image:/path]` markers in the newest tool results into image parts for the model call, keeping at most
 * `limit` images. Transcripts keep the plain-text marker, and images expanded on earlier steps revert to it.
 */
export const withImageParts = async (messages: ModelMessage[], limit = MAX_IMAGES_IN_CONTEXT): Promise<ModelMessage[]> => {
  const expansions = new Map<string, ToolResultOutput>();
  let budget = limit;
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'tool') continue;
    for (const part of [...message.content].reverse()) {
      if (part.type !== 'tool-result' || budget <= 0) continue;
      const text = markerText(part.output);
      if (text === undefined) continue;
      const files = [];
      for (const [, path] of text.matchAll(IMAGE_MARKER)) {
        const file = Bun.file(path!);
        const mediaType = mimeFromExtension(path!);
        if (budget <= 0 || !mediaType || !(await file.exists())) continue;
        files.push({ type: 'file' as const, mediaType, data: { type: 'data' as const, data: Buffer.from(await file.arrayBuffer()).toString('base64') } });
        budget--;
      }
      if (files.length > 0) expansions.set(part.toolCallId, { type: 'content', value: [{ type: 'text', text }, ...files] });
    }
  }

  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'tool') return message;
    let touched = false;
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result') return part;
      const expanded = expansions.get(part.toolCallId);
      const text = markerText(part.output);
      const output: ToolResultOutput | undefined = expanded
        ?? (part.output.type === 'content' && text !== undefined ? { type: 'text', value: text } : undefined);
      if (!output || JSON.stringify(output) === JSON.stringify(part.output)) return part;
      touched = true;
      return { ...part, output };
    });
    if (!touched) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? next : messages;
};
