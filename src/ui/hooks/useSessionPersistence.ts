import type { CapabilitySelection, Fl0wMessage, ModelSelection } from '../../models/agent';
import { resolve } from 'node:path';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionListEntry, SessionRecord, StoredSession } from '../../models/session';
import { deleteSession, getSession, listSessions, saveSession } from '../../services/session/session-repo';
import { createDraftSession } from '../../services/session/session-record';
import { applyCapabilitySelection } from '../../services/agent/config';

type SetMessagesAction = Fl0wMessage[] | ((previous: Fl0wMessage[]) => Fl0wMessage[]);

const SAVE_DEBOUNCE_MS = 400;

export type UseSessionPersistenceResult = {
  messages: Fl0wMessage[];
  setMessages: (update: SetMessagesAction) => void;
  clearSession: () => void;
  getSessions: () => Promise<SessionListEntry[]>;
  loadSession: (sessionId: string) => Promise<StoredSession | null>;
  resumeSession: (sessionId: string) => Promise<void>;
  deleteStoredSession: (sessionId: string) => Promise<void>;
  applySessionCapabilities: (selection: CapabilitySelection) => Promise<void>;
  applySessionModels: (selection: ModelSelection) => Promise<void>;
  session: SessionRecord;
  workspacePath: string;
};

const hasConversation = (fl0wMessages: Fl0wMessage[]) =>
  fl0wMessages.some(({ message }) => message.role !== 'system');

const withoutMessages = ({ messages: _messages, ...session }: StoredSession): SessionRecord => session;

/**
 * The current session, saved to fl0w-work through the outbox: message changes settle for SAVE_DEBOUNCE_MS, then the
 * outbox pushes in the background. `initialSession` is loaded before the TUI renders.
 */
export const useSessionPersistence = (
  initialSession: StoredSession,
  workspacePath = process.cwd(),
): UseSessionPersistenceResult => {
  const workspace = useMemo(() => resolve(workspacePath), [workspacePath]);
  const [session, setSessionState] = useState<SessionRecord>(() => withoutMessages(initialSession));
  const [messages, setMessagesState] = useState<Fl0wMessage[]>(() => initialSession.messages);

  // the latest record and messages, read by saves that outlive a render
  const sessionRef = useRef(session);
  const messagesRef = useRef(messages);
  const dirtyRef = useRef(false);
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSession = useCallback((next: SessionRecord) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const replaceMessages = useCallback((next: Fl0wMessage[]) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const cancelSave = useCallback(() => {
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    dirtyRef.current = false;
  }, []);

  const flushSave = useCallback(() => {
    const dirty = dirtyRef.current;
    cancelSave();
    if (!dirty || !hasConversation(messagesRef.current)) return;
    setSession(saveSession(sessionRef.current, messagesRef.current));
  }, [cancelSave, setSession]);

  useEffect(() => () => flushSave(), [flushSave]);

  const setMessages = useCallback((update: SetMessagesAction) => {
    setMessagesState((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      messagesRef.current = next;
      dirtyRef.current = true;
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
      return next;
    });
  }, [flushSave]);

  const applySessionCapabilities = useCallback(async (selection: CapabilitySelection) => {
    // The agents read the module-level selection, so apply it even when the session record already matches.
    await applyCapabilitySelection(selection);
    if (JSON.stringify(sessionRef.current.capabilities) === JSON.stringify(selection)) return;
    setSession({ ...sessionRef.current, capabilities: selection });
    dirtyRef.current = true;
    flushSave();
  }, [flushSave, setSession]);

  const applySessionModels = useCallback(async (selection: ModelSelection) => {
    if (JSON.stringify(sessionRef.current.models) === JSON.stringify(selection)) return;
    setSession({ ...sessionRef.current, models: selection });
    dirtyRef.current = true;
    flushSave();
  }, [flushSave, setSession]);

  const clearSession = useCallback(() => {
    flushSave();
    setSession(createDraftSession(workspace));
    replaceMessages([]);
  }, [flushSave, replaceMessages, setSession, workspace]);

  const getSessions = useCallback(() => listSessions(workspace), [workspace]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (sessionId !== sessionRef.current.id) return getSession(sessionId);
    flushSave();
    return { ...sessionRef.current, messages: messagesRef.current.filter(({ message }) => message.role !== 'system') };
  }, [flushSave]);

  const resumeSession = useCallback(async (sessionId: string) => {
    const target = await getSession(sessionId);
    if (!target) return;

    flushSave();
    setSession(withoutMessages(target));
    replaceMessages([...target.messages]);
  }, [flushSave, replaceMessages, setSession]);

  const deleteStoredSession = useCallback(async (sessionId: string) => {
    const isCurrent = sessionId === sessionRef.current.id;
    if (isCurrent) cancelSave();
    deleteSession(sessionId);
    if (!isCurrent) return;

    const remaining = await listSessions(workspace).catch(() => []);
    const replacement = remaining[0] ? await getSession(remaining[0].id).catch(() => null) : null;
    setSession(replacement ? withoutMessages(replacement) : createDraftSession(workspace));
    replaceMessages(replacement ? [...replacement.messages] : []);
  }, [cancelSave, replaceMessages, setSession, workspace]);

  return {
    messages,
    setMessages,
    clearSession,
    getSessions,
    loadSession,
    resumeSession,
    deleteStoredSession,
    applySessionCapabilities,
    applySessionModels,
    session,
    workspacePath: workspace,
  };
};
