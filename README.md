# fl0w

Fl0w is a local CLI agent harness that syncs your configs, MCP servers,
skills, and custom tools to your personal cloud machine, so the same
sessions can run unattended via CRON, webhooks, or forms.

Try fl0w at [https://fl0w.work](https://fl0w.work)

## Installation

```bash
# Linux & macOS
curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/jackmuva/fl0w/main/install.ps1 | iex
```

Installs a standalone `fl0w` binary (default `~/.local/bin` on Unix;
no Bun needed). Set `FL0W_VERSION=v0.2.2` to pin a version;
`FL0W_INSTALL_DIR` / `FL0W_BIN_NAME` override location and name.

## Setup

### 1. Sign in

```bash
fl0w login   # approve the code in your browser
```

On first launch fl0w creates `~/.fl0w/` with `mcp.json`, `tools/`,
`skills/`, and `workspace/`.

### 2. Add MCP servers (optional)

Connect the agent to MCP servers. Prefer the CLI:

```bash
fl0w mcp add linear https://mcp.linear.app/mcp                        # remote; OAuth runs on first connect
fl0w mcp add api https://api.remote.com/mcp/ --header "X-Team: eng"   # extra HTTP headers (repeatable)
fl0w mcp add fs npx --env DEBUG=1 -- -y @modelcontextprotocol/server-filesystem ~/code   # local stdio server
fl0w mcp                                                              # list (never shows header/env values)
fl0w mcp remove fs
```

- A target starting with `http://` or `https://` is a remote server;
  anything else is a command run over stdio, with its arguments after
  `--`. `--header` is for remote servers, `--env KEY=VALUE` for commands.
- Running `add` again on an existing name updates it: new headers, env
  vars, and OAuth options merge in, and anything omitted keeps its
  current value.
- `remove` (or changing a server's URL) also clears its stored OAuth
  tokens. New servers connect the next time fl0w starts — run
  `fl0w reauth <name>` to sign in right away.

For providers without dynamic client registration, pass your OAuth app
credentials (create one at the provider, redirect URI
`http://localhost:33418/callback`), or use `--no-oauth` to never run OAuth:

```bash
fl0w mcp add remote-oauth https://api.remote.com/mcp/ \
  --client-id your-client-id --client-secret your-client-secret --scope "repo read:org"
```

Flag values (like `--client-secret` or an `Authorization` header) end up
in your shell history; edit the file directly if you'd rather avoid that.

Or edit `~/.fl0w/mcp.json` by hand (mode `0600`,
[Cursor format](https://cursor.com/docs/mcp#installing-mcp-servers)).
When signed in, it and your MCP OAuth tokens sync with your remote
sandbox in [fl0w.work](https://fl0w.work); if two machines change it,
the newer file wins:

```json
{
  "mcpServers": {
    "remote-oauth": {
      "url": "https://api.remote.com/mcp/",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "scope": "repo read:org",
        "authorizationUrl": "https://remote.com/login/oauth/authorize",
        "tokenUrl": "https://remote.com/login/oauth/access_token"
      }
    },
    "fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/code"],
      "env": { "DEBUG": "1" }
    }
  }
}
```

`clientId`/`clientSecret` replace dynamic registration. Setting both
`authorizationUrl` and `tokenUrl` skips OAuth discovery (file only — no
CLI flag).

### 3. Add secrets (optional)

Let the agent use credentials without seeing them. Prefer the CLI:

```bash
fl0w secrets add github --domain github.com          # prompts for username/password
fl0w secrets add openai --field token --env          # token for the bash tool
fl0w secrets                                         # list (never shows values)
fl0w secrets remove github
```

Or edit `~/.fl0w/secrets.json` by hand (mode `0600`) — each top-level
key is a name, every other string is a field:

```json
{
  "github": {
    "domains": ["github.com"],
    "username": "ada",
    "password": "…" 
    }
}
```

- `domains` limits where `browser_fill` may type the secret (`https`
  only; `"*"` = any site). Referenced as `{"secret": "github.password"}`.
- Values never reach the model and are redacted from tool output.

### 4. Skills and custom tools

- **Skills** — discovered in `<workspace>/.agents/skills`,
  `~/.cursor/skills-cursor`, `~/.claude/skills`, and `~/.fl0w/skills`.
- **Custom tools** — a `.ts` file in `~/.fl0w/tools/` exporting `name`,
  `description`, `inputSchema`, and `execute`.

Any of the above can be toggled per session with `/configure`.

## Usage

```bash
fl0w
```

Type `@` to attach a workspace file (up to 32,000 chars). A sidebar
shows plan progress; the status bar shows context usage and cost.

| Slash command | What it does |
| --- | --- |
| `/clear` | Start a new conversation |
| `/sessions` | Resume a saved session |
| `/configure` | Choose models, MCPs, skills, tools, and `AGENTS.md` |
| `/generate` | Create a workflow from a session |
| `/workflow` | Run a saved workflow |

## Headless CLI

Run the agent from scripts or cron without the TUI. Output is
**JSON lines on stdout** (one object per line); MCP progress and
warnings go to **stderr**.

| Command | Purpose |
| --- | --- |
| `fl0w workflow <id>` | Run a saved workflow unattended |
| `fl0w session [id]` | Run or continue an ad-hoc session (can ask questions) |
| `fl0w capabilities` | List skills, MCPs, tools, and `AGENTS.md` for a session (no login needed) |
| `fl0w reauth [server...]` | Connect MCP servers, running OAuth where needed |
| `fl0w sync` | Manual full sync with fl0w-work |

Headless commands don't persist transcripts — pass prior turns with
`--messages <path.json>` (a `Fl0wMessage[]` array) on each run.
Exit codes: `0` ok, `1` error/stopped, `2` waiting on input.

```bash
fl0w workflow deploy-site --input "target=production" --session nightly-deploy
fl0w session --input "Summarize open P0 issues in this repo"
fl0w session abc-123 --messages prior.json --answers '{"scope":{"optionId":"p0"}}'  # answer a needs_input run
```

**`workflow`** runs with no `ask_question` tool (it assumes and
continues). Flags: `-i/--input` extra instructions, `-s/--session`
stable session id, `-m/--messages` prior transcript.

**`session`** can ask questions: on `needs_input` the result includes
`pendingQuestion` and the exit code is `2`; reply with a follow-up run
using `--messages` plus `--answers` (or `-i` for free text). Other
flags: `-c/--capabilities` (JSON:
`{"skills":[],"mcpServers":[],"userTools":[],"agentsMd":[]}` — names
from `fl0w capabilities`), `--models` (JSON like
`{"EXECUTE":"provider/model"}`), `-m/--messages`.

**`reauth`** connects every server in `mcp.json`, or only the named
ones (`fl0w reauth github linear`).

### JSON-lines output

Replay the lines in order to rebuild the transcript.

| `type` | Meaning |
| --- | --- |
| `snapshot` | Prior + this turn's messages (also re-sent after compaction) |
| `message` | One appended message (`index`, `message`) |
| `stream_delta` / `stream_end` | Live preview text (ignore when replaying) |
| `phase` | Current phase: `DISCOVERY`, `PLAN`, or `EXECUTE` (live only) |
| `usage` | Context % and cumulative tokens/cost (live only) |
| `mcp_auth_required` | Server needs OAuth (emitted once per server) |
| `result` | Final line: `{"type":"result","status":"ok\|error\|stopped\|needs_input","sessionId":"..."}` |

## Development

```bash
bun install       # first
bun dev           # watch mode
bun run lint      # typecheck (tsc --noEmit)
bun test          # colocated *.test.ts suites
bun run build     # standalone binary → ./fl0w
```

## Releasing

```bash
git tag -a v0.2.3 -m "v0.2.3"
git push origin v0.2.3
```

## Project Structure

```text
src/
├── index.tsx   # Entry — dispatches TUI vs CLI
├── tui.tsx     # TUI startup — MCP, sessions, renderer
├── constants.ts # Shared constants (FL0W_HOME, DEFAULT_MODELS, …)
├── cli/        # Headless commands
├── models/     # Types
├── store/      # Session / workflow / model stores
├── services/   # Agent, auth, capabilities, MCP, sync, workflow
└── ui/         # TUI components
```

Details in `AGENTS.md`.

## How It Works

1. **Startup** — scaffolds `~/.fl0w/` and, when signed in, syncs config,
   skills, and tools with fl0w-work.
2. **Load** — connects MCP servers and loads the latest session and
   saved workflows.
3. **Seed** — workspace instructions, enabled `AGENTS.md`, and the
   skills catalog seed the conversation.
4. **Run** — the router picks plan (discovery → plan → execute) or
   execute directly; saved workflows skip straight to execute. Context
   compacts before discovery, plan, and execute when it grows large.
5. **Shutdown** — closes MCP connections and flushes pending
   session/workflow writes (sessions and workflows live on fl0w-work).
