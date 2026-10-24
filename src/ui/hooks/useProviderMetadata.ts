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

  // TODO: fix this
  // const contextPercent = state.lastInputTokens <= 0
  //   ? 0
  //   : Math.min(100, Math.round((state.lastInputTokens / CONTEXT_WINDOW) * 100));
  //
  return { ...state, contextPercent: 0 };
};
