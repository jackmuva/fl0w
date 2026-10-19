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
FL0W_VERSION=v0.1.36 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
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

When signed in, fl0w keeps `config.json`, `mcp.json`, and `auth.json` in sync with your fl0w-work account — encrypted at rest and versioned on the server, so you can move between machines. Changes push ~1 second after you make them; at startup fl0w pulls the latest. If a file changed on both sides since the last sync, the newer copy wins. Disable with `FL0W_SYNC=0`.

**Local mode**: signed out with your own `AI_GATEWAY_API_KEY` (env or `config.json`), fl0w works fully offline — no network calls, no login required.

## Usage

```bash
fl0w
```

### Headless CLI

Run the agent from scripts, cron, or sandboxes without the TUI. Headless commands print **JSON lines on stdout** (one object per line). MCP connection progress and warnings go to **stderr**.

```bash
fl0w help | -h | --help    # list commands and flags
```

**Shared behavior (`workflow` and `session`)**

- Each new agent message is streamed as `{"type":"message","message":{...}}`.
- The run ends with a single result line:

  ```json
  {"type":"result","status":"ok","sessionId":"...","finalMessage":"..."}
  ```

  `status` is `ok`, `error`, `stopped`, or `needs_input`. When the agent left an unanswered question, `status` is `needs_input` and the result includes `pendingQuestion` so you can reply in a follow-up `session` run.
- **Exit codes:** `0` success, `1` error or stopped, `2` ended waiting on input (`needs_input`).
- OAuth MCP servers must already be authorized: run `fl0w` interactively once, or copy `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers log a warning and the run continues without them.

#### `fl0w workflow`

Run a saved workflow unattended.

```bash
fl0w workflow <path/to/workflow.json | workflow-id> [--input "extra instructions"] [--session <session-id>]
```

| Flag | Short | Description |
| --- | --- | --- |
| `--input` | `-i` | Extra instructions appended to the workflow prompt (e.g. webhook payload). |
| `--session` | `-s` | Session to use. Continues an existing session’s messages, or creates one with that id if missing. Omit to start a new session every run. |

- The positional argument is a workflow JSON file on disk, or a workflow **id** stored in `~/.fl0w/fl0w-sqlite.db` (same records the TUI saves with `/generate-workflow`).
- Workflow runs inject a system instruction to avoid clarifying questions when possible; the agent should assume and continue.

Example:

```bash
fl0w workflow deploy-site --input "target=production" --session nightly-deploy
```

#### `fl0w capabilities`

List everything the agent can enable for a session: skills, MCP tools, user tools, and discovered `AGENTS.md` files. Takes no arguments. Useful for building `--capabilities` JSON for `fl0w session`.

```bash
fl0w capabilities
```

Each line is JSON, for example:

```json
{"kind":"skills","name":"my-skill","description":"..."}
{"kind":"mcpServers","name":"github__search_issues","description":"..."}
```


#### `fl0w session`

Send a message and run (or continue) an arbitrary agent session.

```bash
fl0w session [session-id] [--input "<message>"] [--capabilities '<json>']
```

| Argument / flag | Short | Description |
| --- | --- | --- |
| `session-id` | — | Optional. Continue this session, or create it with that id if it does not exist. Omit for a new random id. |
| `--input` | `-i` | User message for this turn. **Required** when the session is new or has no saved messages. |
| `--capabilities` | `-c` | JSON [capability selection](#headless-capability-selection) for this run. Saved on the session when set. If omitted, uses capabilities already stored on the session, or empty. |

Example — start a session, then continue it using `sessionId` from the result line:

```bash
fl0w session --input "Summarize open issues in this repo"
fl0w session abc-123-def --input "Focus on P0 only"
```

##### Headless capability selection

`--capabilities` on `fl0w session` must match this shape (all four keys, string arrays of **names** from `fl0w capabilities`):

```json
{
  "skills": ["my-skill"],
  "mcpServers": ["github__search_issues"],
  "userTools": ["my-tool"],
  "agentsMd": ["AGENTS.md"]
}
```

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
git tag -a v0.1.36 -m "v0.1.36"
git push origin v0.1.36

Replace `v0.1.36` with the version you are releasing.
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
