const HELP_FLAGS = new Set(['help', '-h', '--help']);

export const isHelpInvocation = (): boolean => HELP_FLAGS.has(Bun.argv[2] ?? '');

export const printHelp = (): void => {
  console.log(`fl0w — agent harness with MCP, skills, and workflows

Usage:
  fl0w                              Start the interactive TUI
  fl0w help | -h | --help           Show this help
  fl0w login                        Sign in to fl0w (model calls use your fl0w account)
  fl0w logout                       Sign out
  fl0w whoami                       Show signed-in account
  fl0w sync                         Sync config, auth, skills, and tools with fl0w-work; push pending session/workflow writes

The TUI, workflow, and session commands require fl0w login: sessions and workflows are stored on fl0w-work.

Headless commands (agent output as JSON lines on stdout; MCP progress on stderr):

  fl0w workflow <path.json | workflow-id> [--input "<extra instructions>"] [--session <session-id>] [--messages <path.json>] [--remote]
      Run a saved workflow unattended. Use --session to run in an existing session or create one with that id.
      --messages loads prior messages from a JSON file instead of the session saved on fl0w-work.
      --remote runs without saving the session to fl0w-work.

  fl0w capabilities
      List discoverable skills, MCP tools, user tools, and AGENTS.md (JSON lines).

  fl0w session [session-id] [--input "<message>"] [--answers '<json>'] [--capabilities '<json>'] [--messages <path.json>] [--remote]
      Run or continue a session. Omit session-id to create a new session.
      --messages loads prior messages ([{"message":{...},"frame"?:...}]) from a JSON file instead of the session saved on fl0w-work.
      --remote runs without saving the session to fl0w-work.
      --answers answers the session's pending question: {"<question-id>":{"optionId":"<id>"}} or {"<question-id>":{"customText":"..."}}.
      Without --answers, --input answers a pending question as free text.
      --capabilities sets CapabilitySelection: {"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}

Headless exit codes (workflow and session): 0 success, 1 error or stopped, 2 ended waiting on input.

Config and data live in FL0W_HOME (default ~/.fl0w). See README.md for setup.`);
};

/** Prints usage help. Accepts trailing -h / --help (e.g. \`fl0w help -h\`). */
export const runHelpCommand = async (argv: string[]): Promise<number> => {
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) continue;
    console.error(`Unknown option for help: ${arg}`);
    return 1;
  }
  printHelp();
  return 0;
};
