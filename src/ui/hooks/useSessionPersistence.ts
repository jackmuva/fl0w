import type { CapabilitySelection, JevMessage } from '../../models/agent';
import { applyCapabilitySelection } from '../../services/agent/capabilities';
import { resolve } from 'node:path';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SessionStore, type SessionRecord } from '../../db/session-store';

type SetMessagesAction = JevMessage[] | ((previous: JevMessage[]) => JevMessage[]);

const SAVE_DEBOUNCE_MS = 400;

export type UseSessionPersistenceResult = {
  messages: JevMessage[];
  setMessages: (update: SetMessagesAction) => void;
  clearSession: () => void;
  getSessions: () => SessionRecord[];
  loadSessionMessages: (sessionId: string) => JevMessage[];
  getSessionCapabilities: (sessionId: string) => CapabilitySelection | null;
  resumeSession: (sessionId: string) => void;
  replaceSeedMessages: (seed: JevMessage[]) => void;
  applySessionCapabilities: (selection: CapabilitySelection) => Promise<void>;
  session: SessionRecord;
  workspacePath: string;
};

export const useSessionPersistence = (
  initialSeedMessages: JevMessage[],
  workspacePath = process.cwd(),
): UseSessionPersistenceResult => {
  const [seedMessages, setSeedMessages] = useState(initialSeedMessages);
  const store = useMemo(() => SessionStore.open(), []);
  const workspace = useMemo(() => resolve(workspacePath), [workspacePath]);
  const [session, setSession] = useState<SessionRecord>(() =>
    store.getOrCreateSession(workspace),
  );

  const [messages, setMessagesState] = useState<JevMessage[]>(() => {
    const saved = store.loadMessages(session.id);
    return [...seedMessages, ...saved];
  });

  const sessionIdRef = useRef(session.id);
  sessionIdRef.current = session.id;
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMessagesRef = useRef<JevMessage[] | null>(null);

  const flushSave = useCallback((sessionId = sessionIdRef.current) => {
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
    const toSave = pendingMessagesRef.current;
    if (!toSave) return;
    pendingMessagesRef.current = null;
    store.saveMessages(sessionId, toSave);
  }, [store]);

  useEffect(() => () => flushSave(), [flushSave]);

  const scheduleSave = useCallback((next: JevMessage[]) => {
    pendingMessagesRef.current = next;
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      const toSave = pendingMessagesRef.current;
      pendingMessagesRef.current = null;
      if (toSave) store.saveMessages(sessionIdRef.current, toSave);
    }, SAVE_DEBOUNCE_MS);
  }, [store]);

  const setMessages = useCallback((update: SetMessagesAction) => {
    setMessagesState((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const replaceSeedMessages = useCallback((seed: JevMessage[]) => {
    setSeedMessages(seed);
    setMessagesState((previous) => [
      ...seed,
      ...previous.filter(({ message }) => message.role !== 'system'),
    ]);
  }, []);

  const applySessionCapabilities = useCallback(async (selection: CapabilitySelection) => {
    const seed = await applyCapabilitySelection(selection);
    store.saveCapabilities(session.id, selection);
    setSession((previous) => ({ ...previous, capabilities: selection }));
    replaceSeedMessages(seed);
  }, [replaceSeedMessages, session.id, store]);

  // Start a fresh session instead of wiping the current one, so it stays resumable.
  const clearSession = useCallback(() => {
    flushSave();
    const hasConversation = store.loadMessages(session.id).length > 0;
    if (hasConversation) setSession(store.createSession(workspace));
    setMessagesState([...seedMessages]);
  }, [flushSave, seedMessages, session.id, store, workspace]);

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

  return {
    messages,
    setMessages,
    clearSession,
    getSessions,
    loadSessionMessages,
    getSessionCapabilities,
    resumeSession,
    replaceSeedMessages,
    applySessionCapabilities,
    session,
    workspacePath: workspace,
  };
};
