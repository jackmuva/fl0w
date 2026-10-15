import type { CapabilityCatalog } from "./models/agent"
import { HEADLESS } from "./constants"

// AI SDK logs provider warnings via process.emitWarning by default; suppress for TUI/CLI.
globalThis.AI_SDK_LOG_WARNINGS = false
import { discoverAgentsMd, discoverSkills, frontLoadMessages } from "./services/agent/hooks/front-load"
import { ensureFl0wHome, loadAppConfig } from "./services/config/app-config"
import { fl0wMessage } from "./services/agent/utils/fl0w-message"
import { listUserTools, loadUserTools } from "./services/agent/user-tools/loader"
import { mcpToolKey } from "./models/mcp"
import { mcpClient } from "./services/mcp/mcp-client"
import { flushPendingPushes, syncOnStartup, watchLocalConfigWrites } from "./services/sync/config-sync"
import { isConfigSyncEnabled } from "./services/config/app-config"
import { flushWorkflowPushes, pushWorkflowsInBackground } from "./services/sync/workflow-sync"

await ensureFl0wHome()

const ACCOUNT_COMMANDS = ["login", "logout", "whoami"]
const isAccountCommand = ACCOUNT_COMMANDS.includes(Bun.argv[2] ?? "")

let syncWarning: string | null = null
if (!isAccountCommand) {
  if (await isConfigSyncEnabled()) console.log("Syncing config files...");
  syncWarning = await syncOnStartup();
  watchLocalConfigWrites();
  console.log("Syncing workflows...");
  pushWorkflowsInBackground();
}

// Load before account commands so `fl0w login` knows whether config.json's aiGatewayApiKey takes precedence.
await loadAppConfig()

if (isAccountCommand) {
  const { runAccountCommand } = await import("./services/auth/commands")
  process.exit(await runAccountCommand(Bun.argv[2]!))
}

if (HEADLESS) {
  if (syncWarning) console.error(syncWarning)
  const { runHeadless } = await import("./services/workflow/headless-run")
  const code = await runHeadless(Bun.argv.slice(3))
  await Promise.all([flushPendingPushes(), flushWorkflowPushes()])
  process.exit(code)
}

const { createCliRenderer } = await import("@opentui/core")
const { createRoot } = await import("@opentui/react")
const { App } = await import("./ui/App")
const { disposeAppClipboard, initAppClipboard } = await import("./ui/lib/clipboard/app-clipboard")

let initialMessage: null | string = syncWarning
const seedMessages = (await frontLoadMessages()).map((message) => fl0wMessage(message))

console.log("Connecting MCPs...")
try {
  await mcpClient.loadConfig()
  await mcpClient.connectAll()
} catch (e) {
  initialMessage = [initialMessage, "Error with MCP process: " + e].filter(Boolean).join("\n")
}

await loadUserTools()
const capabilityCatalog: CapabilityCatalog = {
  skills: await discoverSkills(),
  mcpServers: (await mcpClient.listTools()).map((tool) => ({
    name: mcpToolKey(tool),
    description: tool.description,
  })),
  userTools: listUserTools(),
  agentsMd: await discoverAgentsMd(),
}

process.on("exit", () => {
  void mcpClient.close()
  void disposeAppClipboard()
})
const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  exitSignals: [
    "SIGTERM",
    "SIGQUIT",
    "SIGABRT",
    "SIGHUP",
    "SIGBREAK",
    "SIGPIPE",
    "SIGBUS",
  ],
})
initAppClipboard(renderer)
createRoot(renderer).render((
  <App
    initialMessage={initialMessage}
    seedMessages={seedMessages}
    capabilityCatalog={capabilityCatalog}
  />
))
