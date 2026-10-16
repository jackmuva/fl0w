# fl0w

fl0w is an agent harness that **puts the agent in the driver's seat** to drive AI workflows. Treating the agent as a workflow generator makes each turn a decision point: the agent picks the next tool or action in the workflow.

<img src="/public/fl0w-ss.png" alt="fl0w screenshot" width="800" />

The design is twofold:

1. **Explainability** — at each turn you can see the agent-generated probabilities (traces).
2. **Agents as Workflows** — the UX feels like a series of workflow steps, more CLI tool than conversational intelligence.

## Installation

Linux and macOS (latest release):

```bash
curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
```

Specific version:

```bash
FL0W_VERSION=v0.1.30 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jackmuva/fl0w/main/install.ps1 | iex
```

The installer downloads a standalone binary and installs it as `fl0w` (default `~/.local/bin` on Unix). No Bun runtime needed on the target machine.

## Setup

**Sign in** (recommended): run `fl0w login` and approve the code in your browser. fl0w issues you a Vercel AI Gateway key (with a usage budget) saved as `aiGatewayApiKey` in `~/.fl0w/config.json` — no Vercel account needed. `fl0w whoami` shows the account; `fl0w logout` signs out.

**Or bring your own Vercel AI Gateway API Key** ([get one here](https://vercel.com/ai-gateway)). If `AI_GATEWAY_API_KEY` is set (env or `config.json`), `fl0w login` keeps it instead of replacing it.

On first launch fl0w creates `~/.fl0w/` with default `config.json`, `mcp.json`, and `tools/`. Sign-in tokens and MCP OAuth credentials are stored in `~/.fl0w/auth.json` (mode 0600).

1. Edit `~/.fl0w/config.json` — default scaffold looks like:

   ```json
   {
     "aiGatewayApiKey": "YOUR_VERCEL_AI_GATEWAY_API_KEY",
     "llmModel": "zai/glm-5.3-flash",
     "decisionModel": "openai/gpt-6-luna-decisions",
     "contextWindow": 1000000,
     "sync": true
   }
   ```

   `fl0w login` fills in `aiGatewayApiKey` (or set your own / `AI_GATEWAY_API_KEY`). Adjust `llmModel` and `decisionModel` (tool choices) as needed. Model names in [Vercel's model list](https://vercel.com/ai-gateway/models). Set `contextWindow` (or `CONTEXT_WINDOW`) to match your model’s context size — it drives compaction and the usage meter (default `1000000`).
2. Optional: local skills in `~/.fl0w/skills/`.
3. Optional: MCPs in `~/.fl0w/mcp.json`, using [Cursor's MCP config format](https://cursor.com/docs/mcp#installing-mcp-servers).
4. Optional: `AGENTS.md` files alongside your skills.

Skills, MCPs, and templates can be toggled per session to keep the context window focused.

### Keeping your setup in sync

When signed in, fl0w keeps `config.json`, `mcp.json`, and `auth.json` in sync with your fl0w-work account — encrypted at rest and versioned on the server, so you can move between machines. Changes push ~1 second after you make them; at startup fl0w pulls the latest. Local edits are never overwritten (smart three-way merge). Disable with `FL0W_SYNC=0`.

**Local mode**: signed out with your own `AI_GATEWAY_API_KEY` (env or `config.json`), fl0w works fully offline — no network calls, no login required.

## Usage

```bash
fl0w
```

### Headless workflow runs

Run saved workflows without the TUI (script, cron, sandbox):

```bash
fl0w run --workflow <path/to/workflow.json | workflow-id> [--input "extra instructions"]
```

- `--workflow` takes a JSON workflow record file or the id of a workflow saved in `~/.fl0w/fl0w-sqlite.db`.
- `--input` appends extra instructions to the workflow (e.g. a webhook payload).
- Headless runs never ask clarifying questions — the agent assumes instead.
- OAuth MCP servers must already be authorized: run `fl0w` interactively once, or copy
  `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers fail
  fast and the run continues without them.

Output is JSON lines on stdout (one per agent message, then a final result):

```json
{"type":"message","message":{"role":"assistant","content":"..."}}
{"type":"result","status":"ok","finalMessage":"..."}
```

Progress and MCP warnings go to stderr. Exit codes: `0` success, `1` error or stopped, `2` the run ended waiting on a question it couldn't ask.

## Development

```bash
bun install   # first
bun dev       # watch mode
bun run build # local standalone binary → ./fl0w
bun run build:all # release binaries for all platforms
```

## Releasing

Create and push a new version tag (the release workflow picks it up):

```bash
git tag -a v0.1.30 -m "v0.1.30"
git push origin v0.1.30
```

## Project Structure

Clear areas split (details in `AGENTS.md`):

```
src/
├── index.tsx             # Entry point – loads config and renders the TUI
├── constants.ts          # Shared constants (FL0W_HOME, LLM_MODEL, SYSTEM_ONE_MODEL, …)
├── db/                   # Persistence (sessions, workflows)
├── models/               # Data models / types
├── services/             # Business logic (agent, auth, config, mcp, sync, workflow)
└── ui/                   # TUI components
```

## How It Works

1. **Startup** — creates `~/.fl0w/` and scaffolds default `config.json`, `mcp.json`,
   `tools/` when missing, loads config, and sets up model access. If signed in, configs
   reconcile with fl0w-work before anything loads.
2. **Front-loading** — workspace instructions, enabled `AGENTS.md` content, and an enabled
   skills catalog seed the conversation.
3. **MCP connect** — connects to every configured MCP server (optional OAuth). Failures show
   a UI warning instead of crashing.
4. **Tool loading** — registers custom tools from `~/.fl0w/tools`.
5. **Capability discovery** — skills, MCP servers, user tools, and `AGENTS.md` files load
   into a catalog you can toggle in the UI.
6. **Render** — boots the renderer and shows your seeded messages and any initial error.
7. **Agent runtime** — the loop drives the state machine (`START` → `PLAN`/`DISCOVERY` →
   `EXECUTE` → `END`, with `REWIND`).
8. **Shutdown** — closes all MCP connections cleanly.

## Sync & Auth

`fl0w login` signs you into fl0w-work via browser, issues a Vercel AI Gateway key (saved as
`aiGatewayApiKey` unless one is set), and stores sign-in tokens + MCP OAuth credentials in
`~/.fl0w/auth.json` (mode 0600). `fl0w whoami` prints the account; `fl0w logout` signs out.

When signed in, `config.json`, `mcp.json`, and `auth.json` sync with fl0w-work so your setup
follows you across machines (see **Keeping your setup in sync**). In local mode (signed out,
own `AI_GATEWAY_API_KEY`), sync makes no network calls and no login is required.
