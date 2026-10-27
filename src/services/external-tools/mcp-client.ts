import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolModelMessage } from 'ai';
import { FileOAuthProvider } from './oauth-provider';
import type {
  HttpServerConfig,
  StdioServerConfig,
  McpConfig,
  McpConnectionStatus,
  McpServerConfig,
  McpTool,
  McpToolResult,
} from '../../models/mcp';
import { HEADLESS, HEADLESS_MCP_CONNECT_TIMEOUT_MS, MCP_CONFIG_PATH } from '../../constants';
import { configSyncStore } from '../sync/config-sync';

const CLIENT_INFO = { name: 'fl0w', version: '0.1.0' };

const AUTH_FAILURE = /401|unauthorized|token/i;

type ContentPart = {
  type: string,
  text?: string,
  uri?: string,
  mimeType?: string,
  resource?: { uri?: string, text?: string, blob?: string },
};

export type McpClientManagerOptions = {
  onAuthorize?: (server: string, url: URL) => void,
};

export class McpClientManager {
  private config: McpConfig = { mcpServers: {} };
  private clients = new Map<string, Client>();
  private toolCache: McpTool[] | null = null;

  constructor(private readonly options: McpClientManagerOptions = {}) { }

  private isHttpConfig(config: McpServerConfig): config is HttpServerConfig {
    return 'url' in config;
  }

  private createStdioTransport(config: StdioServerConfig): Transport {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...(process.env as Record<string, string>), ...config.env },
      // pipe server logs so they don't draw over the TUI
      stderr: 'pipe',
    });
  }

  private createHttpTransport(config: HttpServerConfig, authProvider?: FileOAuthProvider) {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
      authProvider,
    });
  }

  private formatContent(parts: ContentPart[]): string {
    return parts.map((part) => {
      switch (part.type) {
        case 'text':
          return part.text ?? '';
        case 'resource':
          if (part.resource?.text !== undefined) return part.resource.text;
          if (part.resource?.blob !== undefined) {
            return `[resource blob: ${part.resource.uri ?? 'unknown'}${part.mimeType ? ` (${part.mimeType})` : ''}]`;
          }
          return `[resource: ${part.resource?.uri ?? 'unknown'}]`;
        case 'resource_link':
          return `[resource link: ${part.uri ?? 'unknown'}]`;
        default:
          return `[${part.type}${part.mimeType ? `: ${part.mimeType}` : ''}]`;
      }
    }).join('\n');
  }

  private isAuthOrConnectionFailure(error: unknown): boolean {
    if (error instanceof UnauthorizedError) return true;
    const message = error instanceof Error ? error.message : String(error);
    return AUTH_FAILURE.test(message);
  }

  private formatToolError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async loadConfig(path = MCP_CONFIG_PATH) {
    const file = Bun.file(path);
    this.config = (await file.exists())
      ? await file.json() as McpConfig
      : { mcpServers: {} };
    return this.config;
  }

  async connect(name: string, config: McpServerConfig) {
    await this.disconnect(name);

    const client = this.isHttpConfig(config)
      ? await this.connectHttp(name, config)
      : await this.connectClient(this.createStdioTransport(config));
    this.clients.set(name, client);
    this.toolCache = null;
    return client;
  }

  async connectAll(): Promise<McpConnectionStatus[]> {
    const entries = Object.entries(this.config.mcpServers);
    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.connect(name, config)),
    );

    return results.map((result, i) => ({
      server: entries[i]![0],
      connected: result.status === 'fulfilled',
      error: result.status === 'rejected' ? String(result.reason) : undefined,
    }));
  }

  /** Forget stored OAuth credentials so the next connect re-authorizes. */
  async logout(name: string) {
    await this.disconnect(name);
    const config = this.config.mcpServers[name];
    if (config && this.isHttpConfig(config)) await this.createAuthProvider(name, config)?.invalidateCredentials('all');
  }

  private async connectClient(transport: Transport) {
    const client = new Client(CLIENT_INFO);
    const connecting = client.connect(transport, HEADLESS ? { timeout: HEADLESS_MCP_CONNECT_TIMEOUT_MS } : undefined);
    // read now: connect spawns the server synchronously, and a failed connect forgets it before the rejection lands
    const pid = transport instanceof StdioClientTransport ? transport.pid : null;
    try {
      await connecting;
    } catch (error) {
      // the SDK's close only SIGTERMs after a 2s grace that headless runs exit before, orphaning a stuck server
      if (pid !== null) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // already exited
        }
      }
      throw error;
    }
    return client;
  }

  private async connectHttp(name: string, config: HttpServerConfig) {
    const authProvider = this.createAuthProvider(name, config);
    const transport = this.createHttpTransport(config, authProvider);
    try {
      return await this.connectClient(transport);
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !authProvider) throw error;

      // the provider opened the browser; exchange the code, then reconnect with the new tokens
      const code = await authProvider.waitForAuthorizationCode();
      await transport.finishAuth(code);
      return this.connectClient(this.createHttpTransport(config, authProvider));
    }
  }

  private createAuthProvider(name: string, config: HttpServerConfig) {
    if (config.oauth === false) return undefined;
    const oauthOptions = typeof config.oauth === 'object' ? config.oauth : {};
    return new FileOAuthProvider(name, config.url, oauthOptions, this.options.onAuthorize);
  }

  async disconnect(name: string) {
    const client = this.clients.get(name);
    if (!client) return;
    this.clients.delete(name);
    this.toolCache = null;
    await client.close();
  }

  listServers() {
    return [...this.clients.keys()];
  }

  async listTools(): Promise<McpTool[]> {
    if (this.toolCache) return this.toolCache;

    const perServer = await Promise.all(
      [...this.clients].map(async ([server, client]) => {
        const tools: McpTool[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools({ cursor });
          tools.push(...page.tools.map((tool) => ({
            server,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })));
          cursor = page.nextCursor;
        } while (cursor);
        return tools;
      }),
    );

    this.toolCache = perServer.flat();
    return this.toolCache;
  }

  refreshTools() {
    this.toolCache = null;
    return this.listTools();
  }

  private async invokeCallTool(
    client: Client,
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const result = await client.callTool({ name: tool, arguments: args });
    const content = 'content' in result
      ? this.formatContent(result.content as ContentPart[])
      : JSON.stringify(result.toolResult);
    return { server, tool, isError: Boolean(result.isError), content };
  }

  private async refreshServerFromSync(server: string): Promise<boolean> {
    const results = await configSyncStore.syncConfigFiles();
    if (results === null) return false;
    const errors = Object.values(results).filter((r): r is Error => r instanceof Error);
    if (errors.length) console.error(`[mcp] Config sync: ${errors.map((e) => e.message).join('; ')}`);

    await this.loadConfig();
    const config = this.config.mcpServers[server];
    if (!config) return false;

    try {
      await this.connect(server, config);
      return true;
    } catch {
      return false;
    }
  }

  async callTool(
    server: string,
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolResult> {
    const unknownServer = (): McpToolResult => ({
      server,
      tool,
      isError: true,
      content: `Unknown MCP server: ${server}`,
    });

    let client = this.clients.get(server);
    if (!client) {
      if (!(await this.refreshServerFromSync(server))) return unknownServer();
      client = this.clients.get(server);
      if (!client) return unknownServer();
    }

    try {
      return await this.invokeCallTool(client, server, tool, args);
    } catch (error) {
      if (!this.isAuthOrConnectionFailure(error) || !(await this.refreshServerFromSync(server))) {
        return { server, tool, isError: true, content: this.formatToolError(error) };
      }
      const retryClient = this.clients.get(server);
      if (!retryClient) return unknownServer();
      try {
        return await this.invokeCallTool(retryClient, server, tool, args);
      } catch (retryError) {
        return { server, tool, isError: true, content: this.formatToolError(retryError) };
      }
    }
  }

  toMessage(toolCallId: string, result: McpToolResult): ToolModelMessage {
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName: `${result.server}/${result.tool}`,
        output: { type: result.isError ? 'error-text' : 'text', value: result.content },
      }],
    };
  }

  async close() {
    await Promise.allSettled([...this.clients.keys()].map((name) => this.disconnect(name)));
  }
}

export const mcpClient = new McpClientManager({
  onAuthorize: (server, url) => console.error(`[mcp] Authorize "${server}" in your browser: ${url}`),
});
