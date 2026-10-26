import { loadUserTools } from './services/agent/user-tools/loader';
import { mcpClient } from './services/mcp/mcp-client';
import { buildCapabilityCatalog } from './services/capabilities';
import { modelStore } from './store/model-store';
import type { StoredSession } from './models/session';
import type { WorkflowRecord } from './models/workflow';
import { findLatestSessionWithMessages } from './services/session/session-repo';
import { createDraftSession } from './services/session/session-record';
import { listWorkflows } from './services/workflow/workflow-repo';

const loadMcp = async (initialMessage: string): Promise<string> => {
  console.log('Connecting MCPs...');
  try {
    await mcpClient.loadConfig();
    const mcpStatuses = await mcpClient.connectAll();
    const mcpConnectErrors = mcpStatuses
      .filter((status) => !status.connected)
      .map((status) => `[mcp] ${status.server} not connected: ${status.error}`);
    if (mcpConnectErrors.length > 0) {
      return [initialMessage, ...mcpConnectErrors].filter(Boolean).join('\n');
    }
    return initialMessage;
  } catch (e) {
    return [initialMessage, `Error with MCP process: ${e}`].filter(Boolean).join('\n');
  }
}

const loadWorkspace = async (initialMessage: string): Promise<{
  initialMessage: string,
  initialSession: StoredSession,
  initialWorkflows: WorkflowRecord[],
}> => {
  console.log('Loading sessions and workflows...');
  let message = initialMessage;
  const workspace = process.cwd();
  let initialSession: StoredSession = { ...createDraftSession(workspace), messages: [] };
  let initialWorkflows: WorkflowRecord[] = [];
  try {
    const [latest, workflows] = await Promise.all([findLatestSessionWithMessages(workspace), listWorkflows()]);
    if (latest) initialSession = latest;
    initialWorkflows = workflows;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    message = [initialMessage, `Could not load sessions and workflows from fl0w-work: ${reason}`].filter(Boolean).join('\n');
  }

  return {
    initialMessage: message,
    initialSession,
    initialWorkflows
  }
}

export async function runTui({ syncWarning }: { syncWarning: string | null }): Promise<void> {
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { App } = await import('./ui/App');
  const { disposeAppClipboard, initAppClipboard } = await import('./ui/lib/clipboard/app-clipboard');

  let initialMessage: string = syncWarning ?? "";
  initialMessage = await loadMcp(initialMessage);

  const { initialMessage: newMessage, initialSession, initialWorkflows } = await loadWorkspace(initialMessage);
  initialMessage = newMessage;

  await loadUserTools();
  const capabilityCatalog = await buildCapabilityCatalog();
  const models = [...(await modelStore.loadModels()).values()];

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
      initialSession={initialSession}
      initialWorkflows={initialWorkflows}
      capabilityCatalog={capabilityCatalog}
      models={models}
    />
  );
}
