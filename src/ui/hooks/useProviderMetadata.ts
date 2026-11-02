import { useEffect, useState } from 'react';
import { contextPercentOf, sessionUsageStore } from '../../store/session-usage-store';

/** The current session's usage; `useSessionPersistence` resets or restores it when the session changes. */
export const useProviderMetadata = () => {
  const [state, setState] = useState(() => sessionUsageStore.get());

  useEffect(() => {
    const sync = () => setState(sessionUsageStore.get());
    // catch up on a restore that happened before this subscribed
    sync();
    return sessionUsageStore.subscribe(sync);
  }, []);

  return { ...state, contextPercent: contextPercentOf(state) };
};
