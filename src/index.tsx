import { createGateway } from '@ai-sdk/gateway';
import { FL0W_API_URL } from "./constants";
import { authService } from "./services/auth/auth-service";

const fl0wModelProvider = createGateway({
  baseURL: `${FL0W_API_URL}/api/cli/ai`,
  // Placeholder so the provider skips its env/OIDC key lookup; fetch sets the real bearer token.
  apiKey: 'fl0w',
  fetch: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const send = async (force: boolean) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${await authService.getAccessToken({ force })}`);
      return fetch(input, { ...init, headers });
    };
    const res = await send(false);
    return res.status === 401 ? send(true) : res;
  }, { preconnect: fetch.preconnect }),
});

globalThis.AI_SDK_LOG_WARNINGS = false
globalThis.AI_SDK_DEFAULT_PROVIDER = fl0wModelProvider

import { ensureFl0wHome } from "./services/setup"

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
    const { runAccountCommand } = await import("./cli/auth")
    process.exit(await runAccountCommand(command))
  }
  case "sync": {
    const { runSyncCommand } = await import("./cli/sync")
    process.exit(await runSyncCommand(rest))
  }
  case "workflow": {
    const { runWorkflowCli } = await import("./cli/workflow")
    process.exit(await runWorkflowCli(rest))
  }
  case "session": {
    const { runSessionCli } = await import("./cli/session")
    process.exit(await runSessionCli(rest))
  }
  case "capabilities": {
    const { runCapabilitiesCli } = await import("./services/capabilities")
    process.exit(await runCapabilitiesCli(rest))
  }
  default: {
    const { requireLogin, runStartupSync } = await import("./services/setup")
    if (!(await requireLogin())) process.exit(1)
    const syncWarning = await runStartupSync()
    const { runTui } = await import("./tui")
    await runTui({ syncWarning })
  }
}
