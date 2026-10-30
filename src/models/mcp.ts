export type StdioServerConfig = {
  enabled?: boolean,
  command: string,
  args?: string[],
  env?: Record<string, string>,
}

export type HttpServerConfig = {
  enabled?: boolean,
  url: string,
  headers?: Record<string, string>,
  // OAuth runs automatically when the server responds 401; set false to disable
  oauth?: boolean | OAuthOptions,
}

export type OAuthOptions = {
  // for servers that don't support dynamic client registration
  clientId?: string,
  clientSecret?: string,
  scope?: string,
  // must match the redirect URI registered with the authorization server
  callbackPort?: number,
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>,
}

export type McpTool = {
  server: string,
  name: string,
  description?: string,
  inputSchema: Record<string, unknown>,
}

export const TOOL_KEY_SEPARATOR = '__';

/** Stable id for MCP tools in capability selection and agent actions. Also the tool name sent to the
 * model, so it must match the provider's `^[a-zA-Z0-9_-]{1,128}$` pattern. */
export const mcpToolKey = (tool: Pick<McpTool, 'server' | 'name'>) =>
  `${tool.server}${TOOL_KEY_SEPARATOR}${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

/** Splits a tool key into server and name at the first separator. */
export const parseToolKey = (key: string): { server: string, name: string } => {
  const index = key.indexOf(TOOL_KEY_SEPARATOR);
  return index > 0
    ? { server: key.slice(0, index), name: key.slice(index + TOOL_KEY_SEPARATOR.length) }
    : { server: '', name: key };
};

export type McpToolResult = {
  server: string,
  tool: string,
  isError: boolean,
  content: string,
}

export type McpConnectionStatus = {
  server: string,
  connected: boolean,
  error?: string,
}
