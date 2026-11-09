import { MCP_CONFIG_PATH } from '../constants';
import type { AuthFile } from '../models/auth';
import type { HttpServerConfig, McpConfig, McpServerConfig, OAuthOptions, StdioServerConfig } from '../models/mcp';
import { authService } from '../services/auth/auth-service';
import { writeJsonAtomic } from '../services/service-utils';
import { configSyncStore } from '../services/sync/config-sync';

const USAGE = `Usage:
  fl0w mcp [list]
  fl0w mcp add <name> <url> [--header "<Name>: <value>"]... [--client-id <id>] [--client-secret <secret>] [--scope "<scopes>"] [--no-oauth]
  fl0w mcp add <name> <command> [--env KEY=VALUE]... [-- <arg>...]
  fl0w mcp remove <name>

Manages MCP servers in ${MCP_CONFIG_PATH}. When signed in, the file syncs with fl0w-work; if two machines
change it, the newer file wins. A target starting with http:// or https:// is a remote server; anything else
is a command run over stdio, with its arguments after "--". Re-adding an existing server keeps its other
headers/env and OAuth settings unless overridden; remove also forgets its stored OAuth tokens.
  --header         HTTP header sent to a remote server (repeatable)
  --client-id      OAuth client id, for providers without dynamic client registration
  --client-secret  OAuth client secret (with --client-id)
  --scope          OAuth scopes to request
  --no-oauth       Never run OAuth for this server
  --env            Environment variable for a stdio server (repeatable)`;

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const SYNC_FILES = ['mcp.json', 'auth.json'] as const;

/** Syncs mcp.json and auth.json with fl0w-work. A no-op when signed out; failures only warn, the local files still work. */
const syncMcp = async () => {
  const warning = await configSyncStore.syncOnStartup(SYNC_FILES);
  if (warning) console.error(warning);
};

const readConfig = async (): Promise<McpConfig> => {
  const file = Bun.file(MCP_CONFIG_PATH);
  if (!(await file.exists())) return { mcpServers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`${MCP_CONFIG_PATH} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${MCP_CONFIG_PATH} must be a JSON object`);
  const config = parsed as Partial<McpConfig>;
  return { ...config, mcpServers: config.mcpServers ?? {} };
};

const isHttp = (config: McpServerConfig | undefined): config is HttpServerConfig => !!config && 'url' in config;

const forgetOAuth = (name: string) => authService.updateAuthFile((file: AuthFile) => {
  if (!file.mcp?.[name]) return file;
  const { [name]: _, ...mcp } = file.mcp;
  return { ...file, mcp };
});

const listServers = async () => {
  await syncMcp();
  const entries = Object.entries((await readConfig()).mcpServers);
  if (entries.length === 0) {
    console.log(`No MCP servers yet. Add one with: fl0w mcp add <name> <url>`);
    return 0;
  }
  for (const [name, server] of entries) {
    console.log(name);
    if (isHttp(server)) {
      console.log(`  url:     ${server.url}`);
      if (server.headers) console.log(`  headers: ${Object.keys(server.headers).join(', ')}`);
      if (server.oauth === false) console.log('  oauth:   off');
      else if (typeof server.oauth === 'object' && server.oauth.clientId) console.log(`  oauth:   client ${server.oauth.clientId}`);
    } else {
      console.log(`  command: ${[server.command, ...(server.args ?? [])].join(' ')}`);
      if (server.env) console.log(`  env:     ${Object.keys(server.env).join(', ')}`);
    }
  }
  return 0;
};

const addServer = async (argv: string[]) => {
  const [name, target, ...rest] = argv;
  if (!name || name.startsWith('-')) return usageError('add needs a server name');
  if (!SERVER_NAME_PATTERN.test(name)) return usageError(`Server names may only contain letters, numbers, "-" and "_": ${name}`);
  if (!target || target.startsWith('-')) return usageError('add needs a URL or command');

  const dashDash = rest.indexOf('--');
  const options = dashDash === -1 ? rest : rest.slice(0, dashDash);
  const args = dashDash === -1 ? undefined : rest.slice(dashDash + 1);
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};
  const oauth: OAuthOptions = {};
  let noOAuth = false;
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const next = () => options[++i] ?? '';
    if (option === '--header') {
      const header = next();
      const colon = header.indexOf(':');
      if (colon <= 0) return usageError(`--header needs "<Name>: <value>", got "${header}"`);
      headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
    } else if (option === '--env') {
      const pair = next();
      const eq = pair.indexOf('=');
      if (eq <= 0) return usageError(`--env needs KEY=VALUE, got "${pair}"`);
      env[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (option === '--client-id') oauth.clientId = next();
    else if (option === '--client-secret') oauth.clientSecret = next();
    else if (option === '--scope') oauth.scope = next();
    else if (option === '--no-oauth') noOAuth = true;
    else return usageError(`Unknown option: ${option}`);
  }

  const remote = /^https?:\/\//i.test(target);
  const oauthSet = Object.keys(oauth).length > 0;
  if (remote && Object.keys(env).length) return usageError('--env applies to command servers; use --header for a URL');
  if (remote && args?.length) return usageError('Arguments after "--" apply to command servers, not URLs');
  if (!remote && (Object.keys(headers).length || oauthSet || noOAuth)) return usageError('--header and OAuth options apply to URL servers');
  if (noOAuth && oauthSet) return usageError('--no-oauth cannot be combined with OAuth options');
  if (remote) {
    try {
      new URL(target);
    } catch {
      return usageError(`Invalid URL: ${target}`);
    }
  }

  await syncMcp();
  const config = await readConfig();
  const existing = config.mcpServers[name];
  let server: McpServerConfig;
  if (remote) {
    const previous = isHttp(existing) ? existing : undefined;
    const mergedHeaders = { ...previous?.headers, ...headers };
    const previousOAuth = typeof previous?.oauth === 'object' ? previous.oauth : {};
    server = {
      ...previous,
      url: target,
      ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
      ...(noOAuth ? { oauth: false } : oauthSet ? { oauth: { ...previousOAuth, ...oauth } } : {}),
    } satisfies HttpServerConfig;
    // tokens and client registrations belong to the old server
    if (previous && previous.url !== target) await forgetOAuth(name);
  } else {
    const previous = existing && !isHttp(existing) ? existing : undefined;
    const mergedEnv = { ...previous?.env, ...env };
    // a new command doesn't inherit the old command's arguments
    const mergedArgs = args ?? (previous?.command === target ? previous.args : undefined);
    server = {
      command: target,
      ...(mergedArgs && { args: mergedArgs }),
      ...(Object.keys(mergedEnv).length ? { env: mergedEnv } : {}),
    } satisfies StdioServerConfig;
    if (isHttp(existing)) await forgetOAuth(name);
  }

  await writeJsonAtomic(MCP_CONFIG_PATH, { ...config, mcpServers: { ...config.mcpServers, [name]: server } });
  await syncMcp();
  console.log(`${existing ? 'Updated' : 'Added'} MCP server "${name}". It connects the next time fl0w starts${remote && !noOAuth ? '; run fl0w reauth ' + name + ' to sign in now if it needs OAuth' : ''}.`);
  return 0;
};

const removeServer = async (name: string | undefined) => {
  if (!name) return usageError('remove needs a server name');
  await syncMcp();
  const config = await readConfig();
  if (!config.mcpServers[name]) {
    console.error(`No MCP server named "${name}".`);
    return 1;
  }
  const { [name]: _, ...mcpServers } = config.mcpServers;
  await writeJsonAtomic(MCP_CONFIG_PATH, { ...config, mcpServers });
  await forgetOAuth(name);
  await syncMcp();
  console.log(`Removed MCP server "${name}".`);
  return 0;
};

const usageError = (message: string) => {
  console.error(`${message}\n\n${USAGE}`);
  return 1;
};

export const runMcpCommand = async (argv: string[]): Promise<number> => {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case undefined:
      case 'list':
        return await listServers();
      case 'add':
      case 'set':
        return await addServer(rest);
      case 'remove':
      case 'rm':
        return await removeServer(rest[0]);
      case 'help':
      case '-h':
      case '--help':
        console.log(USAGE);
        return 0;
      default:
        return usageError(`Unknown mcp command: ${subcommand}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
