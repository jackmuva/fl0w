import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { McpServerAuth } from '../../models/auth';
import type { OAuthOptions } from '../../models/mcp';
import { HEADLESS, LEGACY_MCP_AUTH_DIR } from '../../constants';
import { readAuthFile, updateAuthFile } from '../auth/auth-store';
import { callbackUrl, listenForAuthCode } from '../auth/callback-server';
import { openBrowser } from '../utils';

const DEFAULT_CALLBACK_PORT = 33418;

/**
 * Persists OAuth state per MCP server under `mcp` in ~/.fl0w/auth.json and
 * completes the authorization-code flow through a localhost redirect.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  private readonly legacyFile: string;
  private readonly port: number;
  private readonly currentState = crypto.randomUUID();
  private pendingCode: Promise<string> | null = null;

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly options: OAuthOptions = {},
    private readonly onAuthorize: (server: string, url: URL) => void = () => {},
  ) {
    this.legacyFile = join(LEGACY_MCP_AUTH_DIR, `${serverName.replace(/[^\w.-]/g, '_')}.json`);
    this.port = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
  }

  get redirectUrl() {
    return callbackUrl(this.port);
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
    this.pendingCode = listenForAuthCode(this.port, this.currentState).code;
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
      await updateAuthFile(({ mcp: { [this.serverName]: _, ...mcp } = {}, ...file }) => ({ ...file, mcp }));
      await rm(this.legacyFile, { force: true });
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

  private async read(): Promise<McpServerAuth> {
    return this.current((await readAuthFile()).mcp?.[this.serverName], await this.readLegacy());
  }

  /** State saved by older versions under ~/.fl0w/mcp-auth/; moved into auth.json on the next write. */
  private async readLegacy(): Promise<McpServerAuth | undefined> {
    const file = Bun.file(this.legacyFile);
    return await file.exists() ? await file.json() as McpServerAuth : undefined;
  }

  private current(stored: McpServerAuth | undefined, legacy: McpServerAuth | undefined): McpServerAuth {
    const auth = stored ?? legacy ?? {};
    // credentials issued for a different URL are useless (and shouldn't be sent there)
    return auth.serverUrl === this.serverUrl ? auth : {};
  }

  private async write(update: Partial<McpServerAuth>) {
    const legacy = await this.readLegacy();
    await updateAuthFile((file) => {
      const next = { ...this.current(file.mcp?.[this.serverName], legacy), ...update, serverUrl: this.serverUrl };
      return { ...file, mcp: { ...file.mcp, [this.serverName]: next } };
    });
    if (legacy) await rm(this.legacyFile, { force: true });
  }
}
