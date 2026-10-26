import { resolve } from 'node:path';
import type { Fl0wMessage, ModelSelection } from '../../models/agent';
import type { SessionRecord } from '../../models/session';

export const nowIso = (): string => new Date().toISOString();

/** ISO timestamp strictly after `previous` when saves land in the same millisecond. */
export const nextUpdatedAt = (previous?: string | null): string => {
  const now = Date.now();
  const previousMs = previous ? Date.parse(previous) : NaN;
  // Unparseable or far-future (clock skew) previous values fall back to the real clock.
  if (!Number.isFinite(previousMs) || previousMs < now || previousMs - now > 1_000) return new Date(now).toISOString();
  return new Date(previousMs + 1).toISOString();
};

/** New sessions store "" per phase, which falls back to DEFAULT_MODELS. */
export const emptyModelSelection = (): ModelSelection => ({
  ROUTER: '',
  DISCOVERY: '',
  PLAN: '',
  EXECUTE: '',
  SUMMARIZE: '',
});

const MODEL_PHASES = Object.keys(emptyModelSelection()) as (keyof ModelSelection)[];

/** `--models` JSON: a model id per phase; phases left out keep the session's choice. */
export const parseModelsJson = (raw: string): Partial<ModelSelection> | null => {
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

/** First user text, cut to 80 characters. */
export const deriveTitle = (messages: Fl0wMessage[]): string | null => {
  const firstUser = messages.find(({ message }) => message.role === 'user')?.message;
  if (!firstUser) return null;

  const text = typeof firstUser.content === 'string'
    ? firstUser.content
    : Array.isArray(firstUser.content)
      ? firstUser.content
        .map((part) => ('text' in part ? part.text : ''))
        .join('')
      : '';

  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
};

/** A session that exists only in memory until its first save with a conversation. */
export const createDraftSession = (workspacePath: string, id: string = crypto.randomUUID()): SessionRecord => {
  const now = nowIso();
  return {
    id,
    workspacePath: resolve(workspacePath),
    title: null,
    models: emptyModelSelection(),
    capabilities: null,
    createdAt: now,
    updatedAt: now,
  };
};
