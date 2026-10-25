import { loadUserTools } from './services/agent/user-tools/loader';
import { mcpClient } from './services/mcp/mcp-client';
import { buildCapabilityCatalog } from './services/capabilities';
import { loadModels } from './services/model-registry';

export async function runTui({ syncWarning }: { syncWarning: string | null }): Promise<void> {
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { App } = await import('./ui/App');
  const { disposeAppClipboard, initAppClipboard } = await import('./ui/lib/clipboard/app-clipboard');

  let initialMessage: null | string = syncWarning;

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
  const models = [...(await loadModels()).values()];

  process.on('exit', () => {
    void mcpClient.close();
    void disposeAppClipboard();
  });

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    openConsoleOnError: false,
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
  createRoot(renderer).render(
    <App
      initialMessage={initialMessage}
      capabilityCatalog={capabilityCatalog}
      models={models}
    />
  );
}
