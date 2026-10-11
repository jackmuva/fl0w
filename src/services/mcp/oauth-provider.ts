import { chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthOptions } from '../../models/mcp';
import { HEADLESS, MCP_AUTH_DIR } from '../../constants';
const DEFAULT_CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/oauth/callback';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type StoredAuth = {
  serverUrl?: string,
  clientInformation?: OAuthClientInformationMixed,
  tokens?: OAuthTokens,
  codeVerifier?: string,
  discoveryState?: OAuthDiscoveryState,
};

type PendingAuth = {
  resolve: (code: string) => void,
  reject: (error: Error) => void,
  timer: ReturnType<typeof setTimeout>,
};

// One localhost server per port handles redirects for every server, routed by `state`.
const callbackServers = new Map<number, { server: ReturnType<typeof Bun.serve>, pending: Map<string, PendingAuth> }>();

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
      stopIfIdle(port);

      const code = url.searchParams.get('code');
      if (!code) {
        const error = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'missing code';
        entry.reject(new Error(`OAuth authorization failed: ${error}`));
        return callbackPage(`Authorization failed: ${error}. You can close this tab.`);
      }

      entry.resolve(code);
      return callbackPage('Authorization complete. You can close this tab and return to the terminal.');
    },
  });

  const entry = { server, pending };
  callbackServers.set(port, entry);
  return entry;
};

const stopIfIdle = (port: number) => {
  const entry = callbackServers.get(port);
  if (!entry || entry.pending.size > 0) return;
  callbackServers.delete(port);
  entry.server.stop();
};

const waitForAuthCode = (port: number, state: string) => {
  const { pending } = getCallbackServer(port);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(state);
      stopIfIdle(port);
      reject(new Error('Timed out waiting for OAuth authorization'));
    }, AUTH_TIMEOUT_MS);
    pending.set(state, { resolve, reject, timer });
  });
};

const openBrowser = (url: string) => {
  const cmd = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url];
  try {
    Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // no browser available; the URL is still reported via onAuthorize
  }
};

/**
 * Persists OAuth state per MCP server under ~/.fl0w/mcp-auth and
 * completes the authorization-code flow through a localhost redirect.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  private readonly file: string;
  private readonly port: number;
  private readonly currentState = crypto.randomUUID();
  private pendingCode: Promise<string> | null = null;

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly options: OAuthOptions = {},
    private readonly onAuthorize: (server: string, url: URL) => void = () => {},
  ) {
    this.file = join(MCP_AUTH_DIR, `${serverName.replace(/[^\w.-]/g, '_')}.json`);
    this.port = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
  }

  get redirectUrl() {
    return `http://127.0.0.1:${this.port}${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'fl0w',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.options.clientSecret ? 'client_secret_post' : 'none',
      scope: this.options.scope,
    };
  }

  state() {
    return this.currentState;
  }

  async clientInformation() {
    if (this.options.clientId) {
      return { client_id: this.options.clientId, client_secret: this.options.clientSecret };
    }
    return (await this.read()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.write({ clientInformation });
  }

  async tokens() {
    return (await this.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.write({ tokens, codeVerifier: undefined });
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    if (HEADLESS) throw new Error(`MCP server "${this.serverName}" needs authorization; authorize it in interactive fl0w first`);
    // listen before opening the browser so a fast redirect can't be missed
    this.pendingCode = waitForAuthCode(this.port, this.currentState);
    this.onAuthorize(this.serverName, authorizationUrl);
    openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.write({ codeVerifier });
  }

  async codeVerifier() {
    const { codeVerifier } = await this.read();
    if (!codeVerifier) throw new Error(`No PKCE code verifier saved for ${this.serverName}`);
    return codeVerifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    await this.write({ discoveryState });
  }

  async discoveryState() {
    return (await this.read()).discoveryState;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') {
      await rm(this.file, { force: true });
      return;
    }
    const key = ({
      client: 'clientInformation',
      tokens: 'tokens',
      verifier: 'codeVerifier',
      discovery: 'discoveryState',
    } as const)[scope];
    await this.write({ [key]: undefined });
  }

  /** Resolves with the authorization code once the browser redirect arrives. */
  waitForAuthorizationCode() {
    if (!this.pendingCode) throw new Error(`No OAuth authorization in progress for ${this.serverName}`);
    const code = this.pendingCode;
    this.pendingCode = null;
    return code;
  }

  private async read(): Promise<StoredAuth> {
    const file = Bun.file(this.file);
    if (!(await file.exists())) return {};
    const stored = await file.json() as StoredAuth;
    // credentials issued for a different URL are useless (and shouldn't be sent there)
    return stored.serverUrl === this.serverUrl ? stored : {};
  }

  private async write(update: Partial<StoredAuth>) {
    const next = { ...(await this.read()), ...update, serverUrl: this.serverUrl };
    await mkdir(MCP_AUTH_DIR, { recursive: true, mode: 0o700 });
    await Bun.write(this.file, JSON.stringify(next, null, 2));
    await chmod(this.file, 0o600);
  }
}
