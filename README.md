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
FL0W_VERSION=v0.1.52 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
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
     "llmModel": "zai/glm-5.3",
     "decisionModel": "typesafe-ai/jev",
     "mode": "decision",
     "contextWindow": 232000,
     "sync": true
   }
   ```

   `fl0w login` fills in `aiGatewayApiKey` (or set your own / `AI_GATEWAY_API_KEY`). Adjust `llmModel` and `decisionModel` (tool choices) as needed. Set `"mode": "llm"` to run a standard tool-calling loop on `llmModel` instead of the decision-model graph (`decisionModel` is unused in that mode). Model names in [Vercel's model list](https://vercel.com/ai-gateway/models). Set `contextWindow` (or `CONTEXT_WINDOW`) to match your model’s context size — it drives compaction and the usage meter (default `232000`).
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

### TUI slash commands

Type `/` in the input for completions:

| Command | Description |
| --- | --- |
| `/clear` | Clear the saved conversation for this workspace |
| `/sessions` | Choose a saved session to resume |
| `/configure` | Choose which MCPs, skills, tools, and `AGENTS.md` to enable |
| `/generate` | Create a workflow from a saved session |
| `/workflow` | Run a saved workflow with additional instructions |

### Headless CLI

Run the agent from scripts, cron, or sandboxes without the TUI. Headless commands print **JSON lines on stdout** (one object per line). MCP connection progress and warnings go to **stderr**.

```bash
fl0w help | -h | --help    # list commands and flags
```

**Shared behavior (`workflow` and `session`)**

- The transcript streams as replayable lines of `Fl0wMessage`s (`{"message":{...},"frame"?:"summary"|"decision"}`, system messages excluded):
  - `{"type":"snapshot","messages":[...]}` first (prior messages plus this turn's input), and again whenever compaction or a rewind rewrites earlier entries.
  - `{"type":"message","index":N,"message":{...}}` for each appended entry.
  - Replaying the lines in order rebuilds the transcript.
- The run ends with a single result line:

  ```json
  {"type":"result","status":"ok","sessionId":"..."}
  ```

  `status` is `ok`, `error`, `stopped`, or `needs_input`. When the agent left an unanswered question, `status` is `needs_input` and the result includes `pendingQuestion` so you can reply in a follow-up `session` run.
- **`--messages <path.json>`:** load prior messages (a JSON array of `Fl0wMessage`) from a file instead of the local session store. Pair with `--remote` when another service owns the transcript.
- **`--remote`:** do not write to the local session store or sync sessions to fl0w-work. You still get a `sessionId` in the result (in-memory for the run). An existing stored session can still be loaded by id for context; new turns are not persisted.
- **Exit codes:** `0` success, `1` error or stopped, `2` ended waiting on input (`needs_input`).
- OAuth MCP servers must already be authorized: run `fl0w` interactively once, or copy `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers log a warning and the run continues without them.

#### `fl0w workflow`

Run a saved workflow unattended.

```bash
fl0w workflow <path/to/workflow.json | workflow-id> [--input "extra instructions"] [--session <session-id>] [--messages <path.json>] [--remote]
```

| Flag | Short | Description |
| --- | --- | --- |
| `--input` | `-i` | Extra instructions appended to the workflow prompt (e.g. webhook payload). |
| `--session` | `-s` | Session to use. Continues an existing session’s messages, or creates one with that id if missing. Omit to start a new session every run. |
| `--messages` | `-m` | Prior messages JSON file, used instead of the local session store. |
| `--remote` | — | Run without persisting messages or capabilities locally. |

- The positional argument is a workflow JSON file on disk, or a workflow **id** stored in `~/.fl0w/fl0w-sqlite.db` (same records the TUI saves with `/generate`).
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
fl0w session [session-id] [--input "<message>"] [--answers '<json>'] [--capabilities '<json>'] [--messages <path.json>] [--remote]
```

| Argument / flag | Short | Description |
| --- | --- | --- |
| `session-id` | — | Optional. Continue this session, or create it with that id if it does not exist. Omit for a new random id. |
| `--input` | `-i` | User message for this turn. **Required** when the session is new or has no saved messages. |
| `--answers` | `-a` | Answers the session's pending question (`needs_input`): JSON keyed by question id, e.g. `{"q1":{"optionId":"yes"}}` or `{"q1":{"customText":"..."}}`. Without it, `--input` answers a pending question as free text. |
| `--capabilities` | `-c` | JSON [capability selection](#headless-capability-selection) for this run. Saved on the session when set (not when `--remote`). If omitted, uses capabilities already stored on the session, or empty. |
| `--messages` | `-m` | Prior messages JSON file, used instead of the local session store. |
| `--remote` | — | Run without persisting messages or capabilities locally. |

Example — start a session, then continue it using `sessionId` from the result line:

```bash
fl0w session --input "Summarize open issues in this repo"
fl0w session abc-123-def --input "Focus on P0 only"
fl0w session abc-123-def --answers '{"scope":{"optionId":"p0"}}'   # reply to a needs_input result
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
git tag -a v0.1.52 -m "v0.1.52"
git push origin v0.1.52

Replace `v0.1.52` with the version you are releasing.
```

## Project Structure

Clear areas split (details in `AGENTS.md`):

```
src/
├── index.tsx             # Entry point – loads config and renders the TUI
├── constants.ts          # Shared constants (FL0W_HOME, LLM_MODEL, SYSTEM_ONE_MODEL, …)
├── cli/                  # Headless CLI entry points (workflow, session, capabilities, help)
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
7. **Agent runtime** — `mode` in `config.json` (default `decision`) selects the loop.
   Decision mode drives the state machine (`START` → `PLAN`/`DISCOVERY` → `EXECUTE` → `END`,
   with `REWIND`). LLM mode calls `llmModel` with the same tools in a standard generate/execute
   loop (compaction, front-load, and usage tracking still apply; no rewind or tool-filter).
8. **Shutdown** — closes all MCP connections cleanly.

## Sync & Auth

`fl0w login` signs you into fl0w-work via browser, issues a Vercel AI Gateway key (saved as
`aiGatewayApiKey` unless one is set), and stores sign-in tokens + MCP OAuth credentials in
`~/.fl0w/auth.json` (mode 0600). `fl0w whoami` prints the account; `fl0w logout` signs out.

When signed in, `config.json`, `mcp.json`, and `auth.json` sync with fl0w-work so your setup
follows you across machines (see **Keeping your setup in sync**). In local mode (signed out,
own `AI_GATEWAY_API_KEY`), sync makes no network calls and no login is required.
