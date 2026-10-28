# fl0w

Fl0w is a harness that syncs your local CLI configs, MCPs, skills, and custom tools to your personal cloud machine.

The same sessions you use to automate work can be run in the cloud **with zero-config and via CRON, webhooks, or forms**.

Try fl0w at [https://fl0w.work](https://fl0w.work)

## Installation

Linux and macOS (latest release):

```bash
curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | bash
```

Specific version:

```bash
FL0W_VERSION=v0.1.76 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jackmuva/fl0w/main/install.ps1 | iex
```

The installer downloads a standalone binary and installs it as `fl0w` (default `~/.local/bin` on Unix). No Bun runtime needed on the target machine. `FL0W_INSTALL_DIR`, `FL0W_BIN_NAME`, and `FL0W_REPO` override the install directory, command name, and repository.

## Setup

**Sign in**: run `fl0w login` and approve the code in your browser. Model calls go through your fl0w account (fl0w-work's AI proxy), so there's no API key to manage. `fl0w whoami` shows the account; `fl0w logout` signs out. Signing in is required for the TUI and the `workflow`/`session` commands, because sessions and workflows are stored on fl0w-work; `fl0w capabilities` works signed out. Run `fl0w sync` anytime to pull and push config, skills, and user tools, and to push any pending session and workflow writes.

On first launch fl0w creates `~/.fl0w/` with `mcp.json`, `tools/`, `skills/`, and `workspace/`. Sign-in tokens and MCP OAuth credentials are stored in `~/.fl0w/auth.json` (mode 0600).

### Models

Every session assigns a model to five phases, chosen in the `/configure` dialog:

| Phase | Role | Default |
| --- | --- | --- |
| Router (`ROUTER`) | Decision model that picks the next phase: discovery, plan, or execute | `typesafe-ai/jev` |
| Discovery (`DISCOVERY`) | Scopes the task and researches the workspace | `deepseek/deepseek-v4.1-flash` |
| Plan (`PLAN`) | Turns the research into a step-by-step plan | `deepseek/deepseek-v4.1-flash` |
| Execute (`EXECUTE`) | Does the work | `deepseek/deepseek-v4.1-flash` |
| Summarize (`SUMMARIZE`) | Wraps up each turn and summarizes older context during compaction | `deepseek/deepseek-v4.1-flash` |

Phases you leave unassigned fall back to those defaults. The router needs a decision model; the other four take text models. The model list and each model's metadata (including context windows and input prices) are fetched from fl0w-work's `/api/cli/ai/models` endpoint and cached for the process. The context window drives compaction and the usage meter, and defaults to 1,000,000 tokens for models the list doesn't describe. Compaction is checked before discovery, plan, and execute phases; the summarize model writes the compacted summary.

Optional capabilities: local skills in `~/.fl0w/skills/`; MCP servers in `~/.fl0w/mcp.json` (using [Cursor's MCP config format](https://cursor.com/docs/mcp#installing-mcp-servers)); an `AGENTS.md` in the workspace root; and custom TypeScript tools in `~/.fl0w/tools/`. A user tool is a `.ts` file exporting `name`, `description`, `inputSchema`, and `execute` (or a default export with those fields).

Skills are discovered in `<workspace>/.agents/skills`, `~/.cursor/skills-cursor`, `~/.claude/skills`, and `~/.fl0w/skills`; the agent reads one with the `load_skill` tool when it looks relevant. Only the `AGENTS.md` at your workspace root is loaded.

Skills, MCPs, tools, and `AGENTS.md` can be toggled per session to keep the context window focused.

### Keeping your setup in sync

When signed in, fl0w syncs with your fl0w-work account so you can move between machines:

- **Config files** — `mcp.json` and `auth.json` are versioned on the server. The TUI and headless commands reconcile them at startup; use `fl0w sync` to sync manual edits immediately. App-generated `auth.json` writes are pushed about 1 second later. Local fl0w account tokens are not uploaded, though MCP OAuth state is kept in `auth.json`. If both sides changed since the last sync, the newer file wins (`~/.fl0w/sync-state.json`, mode 0600, records the last agreed content).
- **Workflows and TUI sessions** — stored on fl0w-work; `/sessions` and the workflow picker read from there. TUI message changes settle for about 400 ms, then enter `~/.fl0w/outbox/` and are pushed about 2 seconds later in the background. Temporary failures retry with backoff, and pending writes remain on disk for a later run; permanent HTTP errors are discarded. Headless `fl0w session` and `fl0w workflow` commands do not persist transcripts through the CLI: callers provide prior turns with `--messages` and handle any external persistence themselves.
- **Skills and user tools** — every local skill and user tool syncs both ways in the background at startup and by `fl0w sync`, whether or not a workflow uses it (skills outside `~/.fl0w/skills` are mirrored there). Edits made on your cloud computer are pulled into the skill's own folder. Files merge one by one: a file changed on one side takes that side's copy; a file changed on both keeps the newer copy and saves the other under `~/.fl0w/sync-conflicts`. A skill or tool deleted on one side is deleted on the other (a copy of anything deleted here is kept in `~/.fl0w/sync-conflicts`). Merge bases live in `~/.fl0w/bundle-sync-state.json`.

Use **`fl0w sync`** for a full manual sync (config files, every discovered skill, and every user tool in `~/.fl0w/tools`, plus pending session and workflow writes).

## Usage

```bash
fl0w
```

Type `@` in the input to attach a workspace file to your message (contents are inlined, up to 32,000 characters). While the agent works, a sidebar shows plan progress when a plan exists and the status bar shows context usage and cost.

### TUI slash commands

Type `/` in the input for completions:

| Command | Description |
| --- | --- |
| `/clear` | Start a new conversation for this workspace |
| `/sessions` | Choose a saved session to resume |
| `/configure` | Choose which models, MCPs, skills, tools, and `AGENTS.md` to enable |
| `/generate` | Create a workflow from a saved session |
| `/workflow` | Run a saved workflow with additional instructions |

### Headless CLI

Run the agent from scripts, cron, or sandboxes without the TUI. Headless commands print **JSON lines on stdout** (one object per line). MCP connection progress and warnings go to **stderr**.

```bash
fl0w help | -h | --help    # list commands and flags
fl0w login | logout | whoami
fl0w sync                  # manual full sync with fl0w-work
```

`workflow` and `session` require `fl0w login`. They run startup config sync before the agent runs, then push pending session and config writes on exit.

**Shared behavior (`workflow` and `session`)**

- The transcript streams as replayable lines of `Fl0wMessage`s (`{"message":{...},"subagent"?:...}`, where `subagent` is the phase that produced it — `DISCOVERY`, `PLAN`, `EXECUTE`, or `SUMMARY` — and system messages are excluded):
  - `{"type":"snapshot","messages":[...]}` first (prior messages plus this turn's input), and again whenever compaction rewrites earlier entries.
  - `{"type":"message","index":N,"message":{...}}` for each appended entry.
  - Replaying the lines in order rebuilds the transcript.
- While the model writes assistant text, a live preview streams alongside:
  - `{"type":"stream_delta","delta":"..."}` appends to the preview.
  - `{"type":"stream_end"}` discards it (the finished text then arrives as a `message`, or a retried call starts a new preview).
  - The preview isn't part of the transcript, so replays can ignore these lines.
- `{"type":"phase","subagent":"DISCOVERY"}` announces each agent phase as it starts (`DISCOVERY`, `PLAN`, `EXECUTE`, or `SUMMARY`), ending with `{"type":"phase","subagent":null}`. Like the stream preview, phase lines are live-only and not part of the transcript.
- `{"type":"usage","contextPercent":42,"inputTokens":42000,"sessionCostUsd":0.01}` reports current context use and cumulative cost. Usage lines are live-only; replays can keep the latest one.
- `{"type":"mcp_auth_required","server":"...","serverUrl":"..."}` reports an MCP server that needs OAuth authorization. It's emitted once per server per run, and the run continues without that server's tools.
- The run ends with a single result line:

  ```json
  {"type":"result","status":"ok","sessionId":"..."}
  ```

  `status` is `ok`, `error`, `stopped`, or `needs_input`. When the agent left an unanswered question, `status` is `needs_input` and the result includes `pendingQuestion`; continue with a follow-up `session` run and pass the transcript in `--messages`.
- **`--messages <path.json>`:** load prior messages (a JSON array of `Fl0wMessage`) from a file. Headless commands do not read or write session transcripts on fl0w-work; the caller passes prior turns this way on each run.
- **Exit codes:** `0` success, `1` error or stopped, `2` ended waiting on input (`needs_input`).
- OAuth MCP servers must already be authorized: run `fl0w` interactively once, or copy `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers log a warning and the run continues without them.

#### `fl0w workflow`

Run a saved workflow unattended.

```bash
fl0w workflow <workflow-id> [--input "extra instructions"] [--session <session-id>] [--messages <path.json>]
```

| Flag | Short | Description |
| --- | --- | --- |
| `--input` | `-i` | Extra instructions appended to the workflow prompt (e.g. webhook payload). |
| `--session` | `-s` | Stable id returned with this run's result. Omit for a new random id each run. The CLI does not persist the transcript. |
| `--messages` | `-m` | Prior messages JSON file; pass it on continuation runs to restore context. |

- The positional argument is a workflow **id** stored on fl0w-work (same records the TUI saves with `/generate`).
- Workflow runs are unattended: they inject a system instruction to avoid clarifying questions, and the agent isn't offered the `ask_question` tool at all. It assumes, says so, and continues.

Example:

```bash
fl0w workflow deploy-site --input "target=production" --session nightly-deploy
```

#### `fl0w capabilities`

List everything the agent can enable for a session: skills, MCP tools, user tools, and the discovered `AGENTS.md`. Takes no arguments and does not require `fl0w login`. Useful for building `--capabilities` JSON for `fl0w session`.

```bash
fl0w capabilities
```

Each line is JSON, for example:

```json
{"kind":"skills","name":"my-skill","description":"..."}
{"kind":"mcpServers","name":"github/search_issues","description":"..."}
```


#### `fl0w session`

Send a message and run (or continue) an arbitrary agent session.

```bash
fl0w session [session-id] [--input "<message>"] [--answers '<json>'] [--capabilities '<json>'] [--messages <path.json>]
```

| Argument / flag | Short | Description |
| --- | --- | --- |
| `session-id` | — | Optional. Stable id returned with this run's result. Omit for a new random id. The CLI does not persist the transcript. |
| `--input` | `-i` | User message for this turn. **Required** when `--messages` is omitted or empty. |
| `--answers` | `-a` | Answers the session's pending question (`needs_input`): JSON keyed by question id, e.g. `{"q1":{"optionId":"yes"}}` or `{"q1":{"customText":"..."}}`. Without it, `--input` answers a pending question as free text. |
| `--capabilities` | `-c` | JSON [capability selection](#headless-capability-selection) for this run. If omitted, uses empty selection. |
| `--models` | — | JSON mapping phases to model IDs, e.g. `{"EXECUTE":"provider/model"}`. Unspecified phases retain the session choice; an empty string uses the default. |
| `--messages` | `-m` | Prior messages JSON file; pass it on continuation runs to restore context. |

Unlike a workflow, a session can ask questions. When the agent stops on one, the result line reports `needs_input` with a `pendingQuestion` and the process exits `2`; answer it in a follow-up run with the transcript in `--messages` and `--answers` (or `--input` for free text).

Example — start a session, then continue it using both the stable `sessionId` and the transcript (saved/reconstructed from the JSON-lines output) as a `Fl0wMessage[]` file:

```bash
fl0w session --input "Summarize open issues in this repo"
fl0w session abc-123-def --messages prior-messages.json --input "Focus on P0 only"
fl0w session abc-123-def --messages pending-messages.json --answers '{"scope":{"optionId":"p0"}}'   # reply to a needs_input result
```

##### Headless capability selection

`--capabilities` on `fl0w session` must match this shape (all four keys, string arrays of **names** from `fl0w capabilities`):

```json
{
  "skills": ["my-skill"],
  "mcpServers": ["github/search_issues"],
  "userTools": ["my-tool"],
  "agentsMd": ["AGENTS.md"]
}
```

## Development

```bash
bun install       # first
bun dev           # watch mode
bun run lint      # typecheck (tsc --noEmit)
bun test          # colocated *.test.ts suites (bun:test)
bun run build     # local standalone binary → ./fl0w
bun run build:all # release binaries for all platforms
```

## Releasing

Create and push a new version tag (the release workflow picks it up):

```bash
git tag -a v0.1.76 -m "v0.1.76"
git push origin v0.1.76
```

Replace `v0.1.76` with the version you are releasing.

## Project Structure

Clear areas split (details in `AGENTS.md`):

```
src/
├── index.tsx             # Entry point – dispatches TUI vs CLI commands
├── tui.tsx               # TUI startup – MCP connect, sessions/workflows, renderer
├── constants.ts          # Shared constants (FL0W_HOME, DEFAULT_MODELS, WORKSPACE_DIR, …)
├── cli/                  # CLI commands (sync, workflow, session, help, JSON output)
├── models/               # Data models / types
├── store/                # Session, workflow, model, and usage stores
├── services/             # Business logic (agent, auth, capabilities, external-tools,
│                         #   remote-api, setup, sync, workflow)
└── ui/                   # TUI components
```

## How It Works

1. **Startup** — creates `~/.fl0w/` and scaffolds `mcp.json`, `tools/`, `skills/`, and
   `workspace/` when missing. CLI commands dispatch from here; the TUI requires sign-in and
   reconciles config with fl0w-work before loading workspace data.
2. **MCP and workspace loading** — connects to configured MCP servers (optional OAuth), then
   loads the latest workspace session and saved workflows from fl0w-work. MCP failures are
   reported without crashing the TUI.
3. **Capability and model loading** — registers custom tools from `~/.fl0w/tools`, discovers
   skills, MCP tools, user tools, and the root `AGENTS.md`, and loads the model list for
   `/configure`.
4. **Front-loading and render** — after session capabilities are applied, workspace instructions,
   enabled `AGENTS.md` content, and the enabled skills catalog seed the conversation; then the
   TUI renders the session.
5. **Agent runtime** — a router decision model picks discovery, plan, or execute. Discovery
   scopes the task and may ask you a question; plan writes a step-by-step plan; execute does the
   work and retries incomplete plan steps; summarize closes the turn. Compaction checks happen
   before discovery, plan, and execute, using the summarize model. Saved workflows skip routing,
   discovery, and planning and go directly to execute.
6. **Shutdown** — starts MCP connection cleanup and attempts to flush pending writes; headless commands await MCP close and the outbox flush.
