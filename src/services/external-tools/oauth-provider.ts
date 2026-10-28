import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { CliOutput } from '../../models/agent';
import type { AuthFile, McpServerAuth } from '../../models/auth';
import type { OAuthOptions } from '../../models/mcp';
import { HEADLESS } from '../../constants';
import { authService } from '../auth/auth-service';
import { callbackUrl, listenForAuthCode } from './callback-server';
import { openBrowser } from '../service-utils';

const DEFAULT_CALLBACK_PORT = 33418;

/** Tells whoever runs headless fl0w (fl0w-work) which server to re-authorize; once per server per process. */
export class FileOAuthProvider implements OAuthClientProvider {
  private readonly port: number;
  private readonly currentState = crypto.randomUUID();
  private pendingCode: Promise<string> | null = null;
  private reportedAuthRequired = new Set<string>();

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly options: OAuthOptions = {},
    private readonly onAuthorize: (server: string, url: URL) => void = () => { },
  ) {
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

  reportAuthRequired(server: string, serverUrl: string) {
    if (this.reportedAuthRequired.has(server)) return;
    this.reportedAuthRequired.add(server);
    const line: CliOutput = { type: 'mcp_auth_required', server, serverUrl };
    console.log(JSON.stringify(line));
  };

  async redirectToAuthorization(authorizationUrl: URL) {
    if (HEADLESS) {
      this.reportAuthRequired(this.serverName, this.serverUrl);
      throw new Error(`MCP server "${this.serverName}" needs authorization; authorize it in fl0w-work or interactive fl0w`);
    }
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
      await authService.updateAuthFile((file: AuthFile) => {
        const { [this.serverName]: _, ...mcp } = file.mcp ?? {};
        return { ...file, mcp };
      });
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
    return this.current((await authService.readAuthFile()).mcp?.[this.serverName]);
  }

  private current(stored: McpServerAuth | undefined): McpServerAuth {
    const auth = stored ?? {};
    // credentials issued for a different URL are useless (and shouldn't be sent there)
    return auth.serverUrl === this.serverUrl ? auth : {};
  }

  private async write(update: Partial<McpServerAuth>) {
    await authService.updateAuthFile((file: AuthFile) => {
      const next = { ...this.current(file.mcp?.[this.serverName]), ...update, serverUrl: this.serverUrl };
      return { ...file, mcp: { ...file.mcp, [this.serverName]: next } };
    });
  }
}
