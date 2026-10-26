import { useEffect, useState } from 'react';
import { sessionUsageStore } from '../../store/session-usage-store';

export const useProviderMetadata = (sessionId: string) => {
  const [state, setState] = useState(() => sessionUsageStore.get());

  useEffect(() => {
    sessionUsageStore.reset();
  }, [sessionId]);

  useEffect(() => sessionUsageStore.subscribe(() => {
    setState(sessionUsageStore.get());
  }), []);

  const contextPercent = state.lastInputTokens <= 0 || state.contextWindow <= 0
    ? 0
    : Math.min(100, Math.round((state.lastInputTokens / state.contextWindow) * 100));

  return { ...state, contextPercent };
};
