const CALLBACK_PATH = '/oauth/callback';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type PendingAuth = {
  resolve: (code: string) => void,
  reject: (error: Error) => void,
  timer: ReturnType<typeof setTimeout>,
};

const callbackServers = new Map<number, { server: ReturnType<typeof Bun.serve>, pending: Map<string, PendingAuth> }>();

export const callbackUrl = (port: number) => `http://127.0.0.1:${port}${CALLBACK_PATH}`;

const callbackPage = (message: string) => new Response(
  `<html><body style="font-family: sans-serif; padding: 2rem"><p>${message}</p></body></html>`,
  { headers: { 'Content-Type': 'text/html' } },
);

const getCallbackServer = (port: number) => {
  const existing = callbackServers.get(port);
  if (existing) return existing;

  const pending = new Map<string, PendingAuth>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== CALLBACK_PATH) return new Response('Not found', { status: 404 });

      const state = url.searchParams.get('state') ?? '';
      const entry = pending.get(state);
      if (!entry) return callbackPage('Unknown or expired authorization request.');

      pending.delete(state);
      clearTimeout(entry.timer);
      stopIfIdle(server.port!);

      const code = url.searchParams.get('code');
      if (!code) {
        const error = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'missing code';
        entry.reject(new Error(`Authorization failed: ${error}`));
        return callbackPage(`Authorization failed: ${error}. You can close this tab.`);
      }

      entry.resolve(code);
      return callbackPage('Authorization complete. You can close this tab and return to the terminal.');
    },
  });

  const entry = { server, pending };
  callbackServers.set(server.port!, entry);
  return entry;
};

const stopIfIdle = (port: number) => {
  const entry = callbackServers.get(port);
  if (!entry || entry.pending.size > 0) return;
  callbackServers.delete(port);
  entry.server.stop();
};

export const listenForAuthCode = (port: number, state: string) => {
  const { server, pending } = getCallbackServer(port);
  const boundPort = server.port!;
  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(state);
      stopIfIdle(boundPort);
      reject(new Error('Timed out waiting for authorization'));
    }, AUTH_TIMEOUT_MS);
    pending.set(state, { resolve, reject, timer });
  });
  return { port: boundPort, code };
};
