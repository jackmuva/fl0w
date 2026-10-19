import type { CapabilitySelection, Fl0wMessage } from '../../models/agent';
import { applyCapabilitySelection } from '../../services/agent/capabilities';
import { resolve } from 'node:path';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SessionStore, type SessionRecord } from '../../db/session-store';
import { deleteRemoteSessionInBackground, scheduleSessionPush } from '../../services/sync/session-sync';

type SetMessagesAction = Fl0wMessage[] | ((previous: Fl0wMessage[]) => Fl0wMessage[]);

const SAVE_DEBOUNCE_MS = 400;

export type UseSessionPersistenceResult = {
  messages: Fl0wMessage[];
  setMessages: (update: SetMessagesAction) => void;
  clearSession: () => void;
  getSessions: () => SessionRecord[];
  loadSessionMessages: (sessionId: string) => Fl0wMessage[];
  getSessionCapabilities: (sessionId: string) => CapabilitySelection | null;
  resumeSession: (sessionId: string) => void;
  deleteStoredSession: (sessionId: string) => void;
  replaceSeedMessages: (seed: Fl0wMessage[]) => void;
  applySessionCapabilities: (selection: CapabilitySelection) => Promise<void>;
  session: SessionRecord;
  workspacePath: string;
};

export const useSessionPersistence = (
  initialSeedMessages: Fl0wMessage[],
  workspacePath = process.cwd(),
): UseSessionPersistenceResult => {
  const [seedMessages, setSeedMessages] = useState(initialSeedMessages);
  const store = useMemo(() => SessionStore.open(), []);
  const workspace = useMemo(() => resolve(workspacePath), [workspacePath]);
  const [session, setSession] = useState<SessionRecord>(() => {
    store.deleteEmptySessions(workspace);
    return store.findLatestSessionWithMessages(workspace) ?? store.createDraftSession(workspace);
  });

  const [messages, setMessagesState] = useState<Fl0wMessage[]>(() => {
    if (!store.hasSession(session.id)) return [...seedMessages];
    const saved = store.loadMessages(session.id);
    return [...seedMessages, ...saved];
  });

  const sessionIdRef = useRef(session.id);
  sessionIdRef.current = session.id;
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMessagesRef = useRef<Fl0wMessage[] | null>(null);

  const hasConversation = useCallback(
    (fl0wMessages: Fl0wMessage[]) =>
      fl0wMessages.some(({ message }) => message.role !== 'system'),
    [],
  );

  const ensurePersistedSession = useCallback((): SessionRecord => {
    const currentId = sessionIdRef.current;
    const existing = store.listSessions(workspace).find((entry) => entry.id === currentId);
    if (existing) return existing;

    const persisted = store.createSession(workspace, currentId);
    setSession(persisted);
    scheduleSessionPush(store);
    return persisted;
  }, [store, workspace]);

  const flushSave = useCallback((sessionId = sessionIdRef.current) => {
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    const toSave = pendingMessagesRef.current;
    if (!toSave) return;
    if (!hasConversation(toSave)) return;
    pendingMessagesRef.current = null;
    if (!store.hasSession(sessionId)) store.createSession(workspace, sessionId);
    store.saveMessages(sessionId, toSave);
    scheduleSessionPush(store);
  }, [hasConversation, store, workspace]);

  useEffect(() => () => flushSave(), [flushSave]);

  const scheduleSave = useCallback((next: Fl0wMessage[]) => {
    pendingMessagesRef.current = next;
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      const toSave = pendingMessagesRef.current;
      pendingMessagesRef.current = null;
      if (!toSave) return;
      if (!hasConversation(toSave)) return;
      const sessionId = sessionIdRef.current;
      if (!store.hasSession(sessionId)) store.createSession(workspace, sessionId);
      store.saveMessages(sessionId, toSave);
      scheduleSessionPush(store);
    }, SAVE_DEBOUNCE_MS);
  }, [hasConversation, store, workspace]);

  const setMessages = useCallback((update: SetMessagesAction) => {
    setMessagesState((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      if (hasConversation(next) && !store.hasSession(sessionIdRef.current)) {
        ensurePersistedSession();
      }
      scheduleSave(next);
      return next;
    });
  }, [ensurePersistedSession, hasConversation, scheduleSave, store]);

  const replaceSeedMessages = useCallback((seed: Fl0wMessage[]) => {
    setSeedMessages(seed);
    setMessagesState((previous) => [
      ...seed,
      ...previous.filter(({ message }) => message.role !== 'system'),
    ]);
  }, []);

  const applySessionCapabilities = useCallback(async (selection: CapabilitySelection) => {
    const seed = await applyCapabilitySelection(selection);
    const active = store.hasSession(session.id) ? session : ensurePersistedSession();
    store.saveCapabilities(active.id, selection);
    scheduleSessionPush(store);
    setSession((previous) => ({ ...previous, capabilities: selection }));
    replaceSeedMessages(seed);
  }, [ensurePersistedSession, replaceSeedMessages, session, store]);

  const clearSession = useCallback(() => {
    flushSave();
    setSession(store.createDraftSession(workspace));
    setMessagesState([...seedMessages]);
  }, [flushSave, seedMessages, store, workspace]);

  const getSessions = useCallback(() => store.listSessions(workspace), [store, workspace]);

  const loadSessionMessages = useCallback(
    (sessionId: string) => store.loadMessages(sessionId),
    [store],
  );

  const getSessionCapabilities = useCallback(
    (sessionId: string) => store.getCapabilities(sessionId),
    [store],
  );

  const resumeSession = useCallback((sessionId: string) => {
    const target = store.listSessions(workspace).find((entry) => entry.id === sessionId);
    if (!target) return;

    flushSave();
    setSession(target);
    const saved = store.loadMessages(sessionId);
    setMessagesState([...seedMessages, ...saved]);
  }, [flushSave, seedMessages, store, workspace]);

  const deleteStoredSession = useCallback((sessionId: string) => {
    if (sessionId === session.id) flushSave();
    if (!store.deleteSession(sessionId)) return;

    deleteRemoteSessionInBackground(sessionId);
    if (sessionId !== session.id) return;

    const remaining = store.listSessions(workspace);
    const replacement = remaining[0] ?? store.createDraftSession(workspace);
    setSession(replacement);
    const saved = store.hasSession(replacement.id) ? store.loadMessages(replacement.id) : [];
    setMessagesState([...seedMessages, ...saved]);
  }, [flushSave, seedMessages, session.id, store, workspace]);

  return {
    messages,
    setMessages,
    clearSession,
    getSessions,
    loadSessionMessages,
    getSessionCapabilities,
    resumeSession,
    deleteStoredSession,
    replaceSeedMessages,
    applySessionCapabilities,
    session,
    workspacePath: workspace,
  };
};
