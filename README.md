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
FL0W_VERSION=v0.1.68 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | bash
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
| Discovery (`DISCOVERY`) | Scopes the task and researches the workspace | `anthropic/claude-opus-5.5` |
| Plan (`PLAN`) | Turns the research into a step-by-step plan | `anthropic/claude-opus-5.5` |
| Execute (`EXECUTE`) | Does the work | `anthropic/claude-opus-5.5` |
| Summarize (`SUMMARIZE`) | Wraps up each turn, and compacts the transcript as it fills the context window | `anthropic/claude-opus-5.5` |

Phases you leave unassigned fall back to those defaults. The router needs a decision model; the other four take text models. The model list and each model's context window come from fl0w-work's model list (currently mocked in `src/services/remote-api/ai-api.ts`). The context window drives compaction and the usage meter, and defaults to 200,000 tokens for models the list doesn't describe.

1. Optional: local skills in `~/.fl0w/skills/`.
2. Optional: MCPs in `~/.fl0w/mcp.json`, using [Cursor's MCP config format](https://cursor.com/docs/mcp#installing-mcp-servers).
3. Optional: an `AGENTS.md` in your workspace root.
4. Optional: custom tools written in typescript in `~/.fl0w/user-tools/`

Skills are discovered in `<workspace>/.agents/skills`, `~/.cursor/skills-cursor`, `~/.claude/skills`, and `~/.fl0w/skills`; the agent reads one with the `load_skill` tool when it looks relevant. Only the `AGENTS.md` at your workspace root is loaded.

Skills, MCPs, tools, and `AGENTS.md` can be toggled per session to keep the context window focused.

### Keeping your setup in sync

When signed in, fl0w syncs with your fl0w-work account so you can move between machines:

- **Config files** — `mcp.json` and `auth.json` (encrypted at rest, versioned on the server). Changes push ~1 second after you edit them; the TUI and headless commands pull the latest at startup. If a file changed on both sides since the last sync, the newer copy wins (`~/.fl0w/sync-state.json`, mode 0600, records the last content both sides agreed on).
- **Workflows and sessions** — stored on fl0w-work, not on this machine; `/sessions` and the workflow picker read from there. Saves are debounced (~2 seconds after the conversation settles) and pushed in the background. Until a push succeeds, it waits in `~/.fl0w/outbox/`, so nothing is lost while offline or if fl0w exits early, and it retries on the next run. `--remote` headless runs don't save sessions.
- **Skills and user tools** — uploaded when enabled in a session (mirrored under `~/.fl0w/skills` first for skills outside that tree).

Use **`fl0w sync`** for a full manual sync (config files, every discovered skill, and every user tool in `~/.fl0w/tools`, plus pending session and workflow writes).

## Usage

```bash
fl0w
```

Type `@` in the input to attach a workspace file to your message (contents are inlined, up to 32,000 characters). While the agent works, a sidebar tracks the steps of its plan and the status bar shows context usage and cost.

### TUI slash commands

Type `/` in the input for completions:

| Command | Description |
| --- | --- |
| `/clear` | Clear the saved conversation for this workspace |
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
- `{"type":"mcp_auth_required","server":"...","serverUrl":"..."}` reports an MCP server whose OAuth credentials need authorizing again. It's emitted once per server per run, and the run continues without that server's tools.
- The run ends with a single result line:

  ```json
  {"type":"result","status":"ok","sessionId":"..."}
  ```

  `status` is `ok`, `error`, `stopped`, or `needs_input`. When the agent left an unanswered question, `status` is `needs_input` and the result includes `pendingQuestion` so you can reply in a follow-up `session` run.
- **`--messages <path.json>`:** load prior messages (a JSON array of `Fl0wMessage`) from a file instead of the session saved on fl0w-work. Pair with `--remote` when another service owns the transcript.
- **`--remote`:** do not read or save the session on fl0w-work (fl0w-work records remote runs itself). You still get a `sessionId` in the result (in-memory for the run); pass prior turns with `--messages`.
- **Exit codes:** `0` success, `1` error or stopped, `2` ended waiting on input (`needs_input`).
- OAuth MCP servers must already be authorized: run `fl0w` interactively once, or copy `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers log a warning and the run continues without them.

#### `fl0w workflow`

Run a saved workflow unattended.

```bash
fl0w workflow <workflow-id> [--input "extra instructions"] [--session <session-id>] [--messages <path.json>] [--remote]
```

| Flag | Short | Description |
| --- | --- | --- |
| `--input` | `-i` | Extra instructions appended to the workflow prompt (e.g. webhook payload). |
| `--session` | `-s` | Session to use. Continues an existing session's messages, or creates one with that id if missing. Omit to start a new session every run. |
| `--messages` | `-m` | Prior messages JSON file, used instead of the session saved on fl0w-work. |
| `--remote` | — | Run without persisting messages or capabilities locally. |

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
fl0w session [session-id] [--input "<message>"] [--answers '<json>'] [--capabilities '<json>'] [--messages <path.json>] [--remote]
```

| Argument / flag | Short | Description |
| --- | --- | --- |
| `session-id` | — | Optional. Continue this session, or create it with that id if it does not exist. Omit for a new random id. |
| `--input` | `-i` | User message for this turn. **Required** when the session is new or has no saved messages. |
| `--answers` | `-a` | Answers the session's pending question (`needs_input`): JSON keyed by question id, e.g. `{"q1":{"optionId":"yes"}}` or `{"q1":{"customText":"..."}}`. Without it, `--input` answers a pending question as free text. |
| `--capabilities` | `-c` | JSON [capability selection](#headless-capability-selection) for this run. Saved on the session when set (not when `--remote`). If omitted, uses capabilities already stored on the session, or empty. |
| `--messages` | `-m` | Prior messages JSON file, used instead of the session saved on fl0w-work. |
| `--remote` | — | Run without persisting messages or capabilities locally. |

Unlike a workflow, a session can ask questions. When the agent stops on one, the result line reports `needs_input` with a `pendingQuestion` and the process exits `2`; answer it in a follow-up run with `--answers` (or `--input` for free text).

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
git tag -a v0.1.68 -m "v0.1.68"
git push origin v0.1.68
```

Replace `v0.1.68` with the version you are releasing.

## Project Structure

Clear areas split (details in `AGENTS.md`):

```
src/
├── index.tsx             # Entry point – dispatches TUI vs CLI commands
├── tui.tsx               # TUI startup – MCP connect, sessions/workflows, renderer
├── constants.ts          # Shared constants (FL0W_HOME, DEFAULT_MODELS, WORKSPACE_DIR, …)
├── cli/                  # CLI commands (sync, workflow, session, help, JSON output)
├── models/               # Data models / types
├── services/             # Business logic (agent, auth, capabilities, mcp, model-registry,
│                         #   remote-api, session, setup, skills, sync, workflow)
└── ui/                   # TUI components
```

## How It Works

1. **Startup** — creates `~/.fl0w/` and scaffolds `mcp.json`, `tools/`, `skills/`, and
   `workspace/` when missing. CLI commands dispatch from here; the TUI checks for a
   signed-in user and reconciles config with fl0w-work before anything loads.
2. **Front-loading** — workspace instructions, the enabled `AGENTS.md` content, and an enabled
   skills catalog seed the conversation.
3. **MCP connect** — connects to every configured MCP server (optional OAuth). Failures show
   a UI warning instead of crashing.
4. **Tool loading** — registers custom tools from `~/.fl0w/tools`.
5. **Capability discovery** — skills, MCP servers, user tools, and `AGENTS.md` load
   into a catalog you can toggle in the UI, alongside the model list.
6. **Sessions and workflows** — the latest session for this workspace and every saved workflow
   load from fl0w-work before the UI renders.
7. **Render** — boots the renderer and shows your seeded messages and any initial error.
8. **Agent runtime** — a router decision model picks a phase per turn. A *discovery* phase
   scopes the task and researches the workspace (and can ask you a question), a *plan* phase
   writes a step-by-step plan, an *execute* phase does the work, and a *summarize* phase closes
   out the turn. The summarize model also compacts the transcript as it fills the context
   window — compaction runs before each phase.
9. **Shutdown** — closes all MCP connections cleanly.
