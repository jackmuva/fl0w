import { useEffect, useState } from 'react';
import {
  getSessionUsageState,
  resetSessionUsage,
  subscribeSessionUsage,
} from '../../services/agent/hooks/session-usage';

export const useProviderMetadata = (sessionId: string) => {
  const [state, setState] = useState(getSessionUsageState);

  useEffect(() => {
    resetSessionUsage();
  }, [sessionId]);

  useEffect(() => subscribeSessionUsage(() => {
    setState(getSessionUsageState());
  }), []);

  const contextPercent = state.lastInputTokens <= 0 || state.contextWindow <= 0
    ? 0
    : Math.min(100, Math.round((state.lastInputTokens / state.contextWindow) * 100));

  return { ...state, contextPercent };
};
