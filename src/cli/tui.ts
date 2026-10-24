import { frontLoadMessages } from '../services/agent/hooks/front-load';
import { fl0wMessage } from '../services/agent/utils/fl0w-message';
import { loadUserTools } from '../services/agent/user-tools/loader';
import { mcpClient } from '../services/mcp/mcp-client';
import { buildCapabilityCatalog } from './capabilities';

export type RunTuiOptions = {
  syncWarning: string | null;
};

/** Connect MCPs, load tools, and boot the interactive OpenTUI app. */
export async function runTui({ syncWarning }: RunTuiOptions): Promise<void> {
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { App } = await import('../ui/App');
  const { disposeAppClipboard, initAppClipboard } = await import('../ui/lib/clipboard/app-clipboard');

  let initialMessage: null | string = syncWarning;
  const seedMessages = (await frontLoadMessages()).map((message) => fl0wMessage(message));

  console.log('Connecting MCPs...');
  try {
    await mcpClient.loadConfig();
    const mcpStatuses = await mcpClient.connectAll();
    const mcpConnectErrors = mcpStatuses
      .filter((status) => !status.connected)
      .map((status) => `[mcp] ${status.server} not connected: ${status.error}`);
    if (mcpConnectErrors.length > 0) {
      initialMessage = [initialMessage, ...mcpConnectErrors].filter(Boolean).join('\n');
    }
  } catch (e) {
    initialMessage = [initialMessage, `Error with MCP process: ${e}`].filter(Boolean).join('\n');
  }

  await loadUserTools();
  const capabilityCatalog = await buildCapabilityCatalog();

  process.on('exit', () => {
    void mcpClient.close();
    void disposeAppClipboard();
  });

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [
      'SIGTERM',
      'SIGQUIT',
      'SIGABRT',
      'SIGHUP',
      'SIGBREAK',
      'SIGPIPE',
      'SIGBUS',
    ],
  });
  initAppClipboard(renderer);
  createRoot(renderer).render((
    <App
      initialMessage={initialMessage}
      seedMessages={seedMessages}
      capabilityCatalog={capabilityCatalog}
    />
  ));
}
