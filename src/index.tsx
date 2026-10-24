globalThis.AI_SDK_LOG_WARNINGS = false
import { fl0wModelProvider } from "./services/auth/token"
globalThis.AI_SDK_DEFAULT_PROVIDER = fl0wModelProvider
import { ensureFl0wHome, loadAppConfig } from "./services/config/app-config"

await ensureFl0wHome()

const command = Bun.argv[2] ?? ""
const rest = Bun.argv.slice(3)

switch (command) {
  case "help":
  case "-h":
  case "--help": {
    const { runHelpCommand } = await import("./cli/help")
    process.exit(await runHelpCommand(rest))
  }
  case "login":
  case "logout":
  case "whoami": {
    await loadAppConfig()
    const { runAccountCommand } = await import("./services/auth/commands")
    process.exit(await runAccountCommand(command))
  }
  case "sync": {
    await loadAppConfig()
    const { runSyncCommand } = await import("./cli/sync")
    process.exit(await runSyncCommand(rest))
  }
  case "workflow": {
    await loadAppConfig()
    const { runWorkflowCli } = await import("./cli/workflow")
    process.exit(await runWorkflowCli(rest))
  }
  case "session": {
    await loadAppConfig()
    const { runSessionCli } = await import("./cli/session")
    process.exit(await runSessionCli(rest))
  }
  case "capabilities": {
    await loadAppConfig()
    const { runCapabilitiesCli } = await import("./cli/capabilities")
    process.exit(await runCapabilitiesCli(rest))
  }
  default: {
    const { runStartupSync } = await import("./cli/startup-sync")
    const syncWarning = await runStartupSync()
    await loadAppConfig()
    const { runTui } = await import("./cli/tui")
    await runTui({ syncWarning })
  }
}
