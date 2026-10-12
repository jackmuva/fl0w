import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

/** Tokens issued by fl0w-work for `fl0w login`. */
export type Fl0wAuth = {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis when the access token expires. */
  expiresAt: number;
  user: {
    id: string;
    email: string;
  };
};

/** OAuth state for one MCP server. */
export type McpServerAuth = {
  serverUrl?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
};

/** Shape of ~/.fl0w/auth.json. */
export type AuthFile = {
  fl0w?: Fl0wAuth;
  /** Keyed by MCP server name from mcp.json. */
  mcp?: Record<string, McpServerAuth>;
};
