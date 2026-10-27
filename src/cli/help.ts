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

The TUI, workflow, and session commands require fl0w login. TUI sessions and workflows are stored on fl0w-work.

Headless commands (agent output as JSON lines on stdout; MCP progress on stderr):

  fl0w workflow <workflow-id> [--input "<extra instructions>"] [--session <session-id>] [--messages <path.json>]
      Run a saved workflow unattended; the CLI returns a transcript and does not persist it.
      Pass prior turns with --messages when continuing a run.
      Use --session for a stable session id. --messages loads prior messages from a JSON file.
      The run uses the models saved with the workflow (from the session it was generated from).

  fl0w capabilities
      List discoverable skills, MCP tools, user tools, and AGENTS.md (JSON lines).

  fl0w session [session-id] [--input "<message>"] [--answers '<json>'] [--capabilities '<json>'] [--models '<json>'] [--messages <path.json>]
      Run or continue a session; the CLI returns a transcript and does not persist it. Omit session-id for a new id.
      Pass prior turns with --messages when continuing a run.
      --messages loads prior messages ([{"message":{...},"subagent"?:...}]) from a JSON file.
      --answers answers the session's pending question: {"<question-id>":{"optionId":"<id>"}} or {"<question-id>":{"customText":"..."}}.
      Without --answers, --input answers a pending question as free text.
      --capabilities sets CapabilitySelection: {"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}
      --models sets the model per phase: {"ROUTER":"<model>","DISCOVERY":"<model>","PLAN":"<model>","EXECUTE":"<model>","SUMMARIZE":"<model>"}.
      Phases left out keep the session's choice; "" uses the default.

Headless exit codes (workflow and session): 0 success, 1 error or stopped, 2 ended waiting on input.

Config and data live in FL0W_HOME (default ~/.fl0w). See README.md for setup.`);
};

export const runHelpCommand = async (argv: string[]): Promise<number> => {
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) continue;
    console.error(`Unknown option for help: ${arg}`);
    return 1;
  }
  printHelp();
  return 0;
};
