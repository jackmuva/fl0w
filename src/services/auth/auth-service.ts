import { AUTH_PATH, FL0W_API_URL } from '../../constants';
import type { AuthFile, Fl0wAuth } from '../../models/auth';
import { configSyncStore } from '../sync/config-sync';
import { writeJsonAtomic } from '../utils';

class Fl0wAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

class NotLoggedInError extends Error {
  constructor() {
    super('Not signed in to fl0w. Run `fl0w login`.');
  }
}

const REFRESH_SKEW_MS = 60_000;

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
};

type TokenRequest =
  | { grant_type: 'authorization_code', code: string, code_verifier: string }
  | { grant_type: 'refresh_token', refresh_token: string };

class AuthService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<Fl0wAuth> | null = null;

  async readAuthFile(path = AUTH_PATH): Promise<AuthFile> {
    const file = Bun.file(path);
    if (!(await file.exists())) return {};
    try {
      return await file.json() as AuthFile;
    } catch {
      return {};
    }
  }

  /**
   * Applies `update` to auth.json and writes it atomically with 0600 permissions.
   * Returning `file` unchanged skips the write. `notify: false` is for config sync's own writes, so pulled content isn't pushed straight back.
   */
  async updateAuthFile(
    update: (file: AuthFile) => AuthFile,
    path = AUTH_PATH,
    { notify = true } = {},
  ): Promise<AuthFile> {
    const run = this.writeQueue.then(async () => {
      const current = await this.readAuthFile(path);
      const next = update(current);
      if (next === current) return current;
      await writeJsonAtomic(path, next);
      if (notify) configSyncStore.notifyLocalWrite(path);
      return next;
    });
    this.writeQueue = run.catch(() => { });
    return run;
  }


  async readFl0wAuth(): Promise<Fl0wAuth | null> {
    return (await this.readAuthFile()).fl0w ?? null;
  }

  async requestTokens(request: TokenRequest): Promise<Fl0wAuth> {
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
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? 0) * 1000,
      user: body.user,
    };
  }

  async saveFl0wAuth(auth: Fl0wAuth): Promise<void> {
    await this.updateAuthFile((file) => ({ ...file, fl0w: auth }));
  }

  async clearFl0wAuth(): Promise<void> {
    await authService.updateAuthFile(({ fl0w: _, ...rest }) => rest);
  }

  refresh(auth: Fl0wAuth): Promise<Fl0wAuth> {
    this.refreshing ??= (async () => {
      try {
        const next = await this.requestTokens({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
        await this.saveFl0wAuth(next);
        return next;
      } catch (error) {
        if (error instanceof Fl0wAuthError && error.code === 'invalid_grant') {
          await this.clearFl0wAuth();
          throw new NotLoggedInError();
        }
        throw error;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  };

  async getAccessToken({ force = false } = {}): Promise<string> {
    const auth = await this.readFl0wAuth();
    if (!auth) throw new NotLoggedInError();
    if (!force && auth.expiresAt - Date.now() > REFRESH_SKEW_MS) return auth.accessToken;
    return (await this.refresh(auth)).accessToken;
  }
}

export const authService = new AuthService();
