import { ACCOUNT_COMMANDS, HEADLESS } from "./constants"

// AI SDK logs provider warnings via process.emitWarning by default; suppress for TUI/CLI.
globalThis.AI_SDK_LOG_WARNINGS = false
import { fl0wModelProvider } from "./services/auth/token"
// Model ids resolve through the default provider: fl0w-work's AI proxy, authenticated with the fl0w login.
globalThis.AI_SDK_DEFAULT_PROVIDER = fl0wModelProvider
import { frontLoadMessages } from "./services/agent/hooks/front-load"
import { ensureFl0wHome, loadAppConfig } from "./services/config/app-config"
import { fl0wMessage } from "./services/agent/utils/fl0w-message"
import { loadUserTools } from "./services/agent/user-tools/loader"
import { mcpClient } from "./services/mcp/mcp-client"
import { flushPendingPushes, syncOnStartup, watchLocalConfigWrites } from "./services/sync/config-sync"
import { isConfigSyncEnabled } from "./services/config/app-config"
import { flushWorkflowPushes, syncWorkflowsInBackground } from "./services/sync/workflow-sync"
import { flushSessionPushes, syncSessionsInBackground } from "./services/sync/session-sync"
import { flushPendingSkillMirrors } from "./services/skills/mirror-enabled-skills"

await ensureFl0wHome()

const { isHelpInvocation, runHelpCommand } = await import("./cli/help")
if (isHelpInvocation()) {
  process.exit(await runHelpCommand(Bun.argv.slice(3)))
}

const isAccountCommand = ACCOUNT_COMMANDS.includes(Bun.argv[2] ?? "")
const isRemoteRun = HEADLESS && Bun.argv.includes("--remote")
const log = HEADLESS ? console.error : console.log

let syncWarning: string | null = null
if (!isAccountCommand) {
  const syncEnabled = await isConfigSyncEnabled()
  if (syncEnabled) {
    log("Syncing config files...");
    syncWarning = await syncOnStartup();
    watchLocalConfigWrites();
    log(isRemoteRun ? "Syncing workflows..." : "Syncing workflows and sessions...");
    syncWorkflowsInBackground();
    if (!isRemoteRun) syncSessionsInBackground();
  }
}

await loadAppConfig()

if (isAccountCommand) {
  const { runAccountCommand } = await import("./services/auth/commands")
  process.exit(await runAccountCommand(Bun.argv[2]!))
}

if (HEADLESS) {
  if (syncWarning) console.error(syncWarning)
  const headlessCommand = Bun.argv[2]!
  let code = 1
  if (headlessCommand === "workflow") {
    const { runWorkflowCommand } = await import("./cli/workflow")
    code = await runWorkflowCommand(Bun.argv.slice(3))
  } else if (headlessCommand === "capabilities") {
    const { runCapabilitiesCommand } = await import("./cli/capabilities")
    code = await runCapabilitiesCommand(Bun.argv.slice(3))
  } else if (headlessCommand === "session") {
    const { runSessionCommand } = await import("./cli/session")
    code = await runSessionCommand(Bun.argv.slice(3))
  } else {
    console.error(`Headless command not implemented: ${headlessCommand}`)
  }
  void flushPendingSkillMirrors()
  await Promise.all([flushPendingPushes(), flushWorkflowPushes(), flushSessionPushes()])
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
  const mcpStatuses = await mcpClient.connectAll()
  const mcpConnectErrors = mcpStatuses.filter((status) => !status.connected).map((status) => `[mcp] ${status.server} not connected: ${status.error}`)
  if (mcpConnectErrors.length > 0) {
    initialMessage = [initialMessage, ...mcpConnectErrors].filter(Boolean).join("\n")
  }
} catch (e) {
  initialMessage = [initialMessage, "Error with MCP process: " + e].filter(Boolean).join("\n")
}

await loadUserTools()
const { buildCapabilityCatalog } = await import("./cli/capabilities")
const capabilityCatalog = await buildCapabilityCatalog()

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
  <App initialMessage={initialMessage}
    seedMessages={seedMessages}
    capabilityCatalog={capabilityCatalog}
  />
))
