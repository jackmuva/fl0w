import { FL0W_API_URL } from '../../constants';
import type { Fl0wAuth } from '../../models/auth';
import { readAuthFile, updateAuthFile } from './auth-store';

const REFRESH_SKEW_MS = 60_000;

export class Fl0wAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class NotLoggedInError extends Error {
  constructor() {
    super('Not signed in to fl0w. Run `fl0w login` (or set AI_GATEWAY_API_KEY).');
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
  /** Only returned for the authorization_code grant (`fl0w login`). */
  ai_gateway_api_key?: string;
};

type TokenRequest =
  | { grant_type: 'authorization_code', code: string, code_verifier: string }
  | { grant_type: 'refresh_token', refresh_token: string };

export async function requestTokens(request: TokenRequest): Promise<{ auth: Fl0wAuth, aiGatewayApiKey?: string }> {
  const res = await fetch(`${FL0W_API_URL}/api/cli/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await res.json().catch(() => ({})) as Partial<TokenResponse> & { error?: string, error_description?: string };
  if (!res.ok || !body.access_token || !body.refresh_token || !body.user) {
    const code = body.error ?? `http_${res.status}`;
    throw new Fl0wAuthError(code, body.error_description ?? `fl0w sign-in failed (${code})`);
  }
  return {
    auth: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? 0) * 1000,
      user: body.user,
    },
    aiGatewayApiKey: body.ai_gateway_api_key,
  };
}

export async function readFl0wAuth(): Promise<Fl0wAuth | null> {
  return (await readAuthFile()).fl0w ?? null;
}

export async function saveFl0wAuth(auth: Fl0wAuth): Promise<void> {
  await updateAuthFile((file) => ({ ...file, fl0w: auth }));
}

export async function clearFl0wAuth(): Promise<void> {
  await updateAuthFile(({ fl0w: _, ...rest }) => rest);
}

let refreshing: Promise<Fl0wAuth> | null = null;

const refresh = (auth: Fl0wAuth): Promise<Fl0wAuth> => {
  refreshing ??= (async () => {
    try {
      const { auth: next } = await requestTokens({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
      await saveFl0wAuth(next);
      return next;
    } catch (error) {
      if (error instanceof Fl0wAuthError && error.code === 'invalid_grant') {
        await clearFl0wAuth();
        throw new NotLoggedInError();
      }
      throw error;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

export async function getAccessToken({ force = false } = {}): Promise<string> {
  const auth = await readFl0wAuth();
  if (!auth) throw new NotLoggedInError();
  if (!force && auth.expiresAt - Date.now() > REFRESH_SKEW_MS) return auth.accessToken;
  return (await refresh(auth)).accessToken;
}
