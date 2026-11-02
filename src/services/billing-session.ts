import { AsyncLocalStorage } from 'node:async_hooks';

/** fl0w-work bills each model call to the wallet; this header also attributes it to a session's spend. */
export const SESSION_HEADER = 'x-fl0w-session-id';

const billingSession = new AsyncLocalStorage<string>();

/** Runs `fn` so every model call it makes is billed to `sessionId`. */
export const withBillingSession = <T>(sessionId: string, fn: () => Promise<T>): Promise<T> =>
  billingSession.run(sessionId, fn);

export const currentBillingSession = (): string | undefined => billingSession.getStore();
