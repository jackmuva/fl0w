import { useEffect, useState } from 'react';
import { contextPercentOf, sessionUsageStore } from '../../store/session-usage-store';

export const useProviderMetadata = (sessionId: string) => {
  const [state, setState] = useState(() => sessionUsageStore.get());

  useEffect(() => {
    sessionUsageStore.reset();
  }, [sessionId]);

  useEffect(() => sessionUsageStore.subscribe(() => {
    setState(sessionUsageStore.get());
  }), []);

  return { ...state, contextPercent: contextPercentOf(state) };
};
