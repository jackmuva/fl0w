import { mcpClient } from '../services/external-tools/mcp-client';
import { configSyncStore } from '../services/sync/config-sync';
import { finishHeadlessRun } from '../services/setup';

const HELP_FLAGS = new Set(['help', '-h', '--help']);

const USAGE = `Usage: fl0w reauth [server...]

Connect to every MCP server in ~/.fl0w/mcp.json (or only the named ones), running the OAuth
browser flow for any that need authorization. Servers connect one at a time so their OAuth
callbacks don't collide. When signed in, mcp.json/auth.json sync with fl0w-work before and after.

Exits 1 if any server fails to connect.`;

export const runReauthCommand = async (argv: string[]): Promise<number> => {
  const names: string[] = [];
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) {
      console.log(USAGE);
      return 0;
    }
    if (arg.startsWith('-')) {
      console.error(`Unknown option for reauth: ${arg}`);
      return 1;
    }
    names.push(arg);
  }

  const syncWarning = await configSyncStore.syncOnStartup();
  if (syncWarning) console.error(syncWarning);
  configSyncStore.watchLocalConfigWrites();

  const config = await mcpClient.loadConfig();
  const unknown = names.filter((name) => !(name in config.mcpServers));
  if (unknown.length) {
    console.error(`Unknown MCP server${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    return 1;
  }
  const servers = Object.entries(config.mcpServers).filter(([name]) => !names.length || names.includes(name));
  if (!servers.length) {
    console.log('No MCP servers configured in mcp.json.');
    return 0;
  }

  let failed = 0;
  for (const [name, serverConfig] of servers) {
    console.log(`Connecting ${name}...`);
    try {
      await mcpClient.connect(name, serverConfig);
      console.log(`  ${name}: connected`);
    } catch (error) {
      failed++;
      console.log(`  ${name}: failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await mcpClient.close();
  console.log(failed ? `${failed} of ${servers.length} servers failed to connect.` : `All ${servers.length} servers connected.`);
  return failed ? 1 : 0;
};

export const runReauthCli = async (argv: string[]): Promise<number> =>
  finishHeadlessRun(await runReauthCommand(argv));
