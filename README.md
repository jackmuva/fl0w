# fl0w

fl0w is an agent harness that **puts Jev in the driver's seat** to drive AI workflows. Thinking of an agent as a workflow generator each turn is a decision point, Jev can pick from a variety of tools and actions for the next step in the workflow.

<img src="/public/fl0w-ss.png" alt="fl0w screenshot" width="800" />

The design behind fl0w is two-fold:

1. **Explainability**: At each turn, you can see the Jev-generated probabilities (traces)

2. **Agents as Workflows**: The UX for fl0w should feel like a workflow with a series of steps, more CLI tool than a "conversational intelligence"

## Installation

Install the latest release with curl (Linux and macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
```

Install a specific version:

```bash
FL0W_VERSION=v0.1.16 curl -fsSL https://raw.githubusercontent.com/jackmuva/fl0w/main/install.sh | sh
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jackmuva/fl0w/main/install.ps1 | iex
```

The installer downloads a standalone binary and installs it as `fl0w` (by default to `~/.local/bin` on Unix). No Bun runtime is required on the target machine.

## Setup

### Requirements

**Sign in** (recommended): run `fl0w login` and approve the code in your browser. Model calls are then proxied through the fl0w web service, so you don't need your own key. `fl0w whoami` shows the signed-in account and `fl0w logout` signs out.

**Or bring your own Vercel AI Gateway API Key**: You can pick one up at [Vercel's website](https://vercel.com/ai-gateway). If `AI_GATEWAY_API_KEY` is set (env or `config.json`), fl0w calls the gateway directly and ignores `fl0w login`.

### Configure

On first launch, fl0w creates `~/.fl0w/` with default `config.json`, `mcp.json`,
and `tools/`. Sign-in tokens from `fl0w login` and MCP OAuth credentials are stored
together in `~/.fl0w/auth.json` (mode 0600).

1. Edit `~/.fl0w/config.json` to set your preferred `llmModel` (and `aiGatewayApiKey` if you're not using `fl0w login`). Model names are found in [Vercel's mode list](https://vercel.com/ai-gateway/models).

2. \[Optional\] local skills can be placed in `~/.fl0w/skills/`.

3. \[Optional\] MCPs can be place in `~/.fl0w/mcp.json` and follow [Cursor's MCP config format](https://cursor.com/docs/mcp#installing-mcp-servers).

4. \[Optional\] `AGENTS.md` files alongside your skills

Skills, MCPs, and templates can all be toggled in each session to keep the context window focused.

## Usage

Run the installed binary:

```bash
fl0w
```

### Headless workflow runs

Saved workflows can run without the TUI, e.g. from a script, cron job, or sandbox:

```bash
fl0w run --workflow <path/to/workflow.json | workflow-id> [--input "extra instructions"]
```

- `--workflow` takes either a JSON file containing a workflow record, or the id of
  a workflow saved in `~/.fl0w/fl0w-sqlite.db`.
- `--input` is appended to the workflow as additional instructions (e.g. a webhook payload).
- Headless runs never ask clarifying questions; the agent makes reasonable assumptions instead.
- MCP servers that need OAuth must already be authorized: run `fl0w` interactively once,
  or copy `~/.fl0w/auth.json` (MCP credentials live under its `mcp` key). Unauthorized servers fail fast
  and the run continues without them.

Output is JSON lines on stdout, one per agent message, followed by a final result:

```json
{"type":"message","message":{"role":"assistant","content":"..."}}
{"type":"result","status":"ok","finalMessage":"..."}
```

Progress and MCP warnings go to stderr. Exit codes: `0` success, `1` error or stopped,
`2` the run ended waiting on a question it could not ask.

## Development

Install dependencies and run in watch mode:

```bash
bun install
bun dev
```

Build a local standalone binary:

```bash
bun run build
./fl0w
```

Build release binaries for all supported platforms:

```bash
bun run build:all
```

## Releasing

Create and push a new version tag:

```bash
git tag -a v0.1.16 -m "v0.1.16"
git push origin v0.1.16
```

Replace `v0.1.16` with the version you are releasing. Tags are pushed to GitHub and picked up by the release workflow.

## Project Structure

```
src/
├── index.tsx             # Entry point – loads config, initializes MCP, loads tools, renders the TUI
├── constants.ts          # Shared constants (JEV_HOME, LLM_MODEL, SYSTEM_ONE_MODEL, DB_PATH, …)
├── db/                   # Persistence
│   ├── session-store.ts      # Session persistence (chat history resume via /resume)
│   ├── session-store.test.ts
│   ├── workflow-store.ts     # Workflow persistence
│   └── workflow-store.test.ts
├── models/               # Data models / types
│   ├── agent.ts          # Agent model types (AgentState, CapabilityKind, JevMessage, …)
│   ├── config.ts         # AppConfig (aiGatewayApiKey, llmModel)
│   ├── mcp.ts            # MCP types
│   ├── ui.ts             # UI-related types
│   └── workflow.ts       # Workflow types
├── services/             # Business logic
│   ├── agent/            # Agent loop, graph, capabilities, prompts, skills & tools
│   │   ├── agent-loop.ts     # Agent loop orchestration (jevLoop)
│   │   ├── capabilities.ts   # Capability selection state & helpers
│   │   ├── capabilities.test.ts
│   │   ├── graph.ts          # Agent graph runtime (START/PLAN/DISCOVERY/EXECUTE/END/REWIND)
│   │   ├── prompt.ts         # Prompt building
│   │   ├── default-tools/    # Built-in tools (apply-patch, bash, create-plan, read-file, …)
│   │   ├── hooks/            # front-load / compaction / rewind hooks + tests + fixtures
│   │   ├── user-tools/       # User tool discovery & loading (loader.ts)
│   │   └── utils/            # jev-message, ask-question-state helpers
│   ├── auth/             # fl0w login, auth.json store, localhost OAuth callback, gateway proxy provider
│   ├── config/           # App config loading (loadAppConfig(), ensureJevHome())
│   ├── mcp/              # mcp-client.ts & oauth-provider.ts
│   └── workflow/         # build-message, extract-tool-calls, generate
└── ui/                   # TUI components
    ├── App.tsx           # Root React component for the TUI; wires agent loop, dialogs
    ├── hooks/            # e.g. useSessionPersistence
    ├── lib/              # format / input-completion helpers
    ├── syntax-style.ts       # Syntax highlighting for code views
    ├── tool-renderers.tsx    # Tool-specific render helpers
    └── components/       # input/, session/, tools/, workflow/, primitives/ subcomponents
```

## How It Works

1. **Startup** – `ensureJevHome()` creates `~/.fl0w/` and scaffolds default
   `config.json`, `mcp.json`, and `tools/` when missing, then
   `loadAppConfig()` reads `config.json` and populates env vars (e.g.
   `AI_GATEWAY_API_KEY`, `LLM_MODEL`). Without a gateway key, if `auth.json` has
   `fl0w login` tokens, model calls are routed through fl0w-work's `/api/ai` proxy.
2. **Front-loading** – workspace-root instructions, enabled `AGENTS.md` content,
   and an enabled skills catalog (from `discoverSkills()` and
   `discoverAgentsMd()`) seed the conversation.
3. **MCP connect** – `mcpClient.loadConfig()` reads configuration from the
   environment, then `connectAll()` connects to every configured server (with
   optional OAuth support). If MCP setup fails, a warning message is shown in the
   UI instead of crashing.
4. **Tool loading** – `loadUserTools()` registers custom tools in the `user`
   tool-server namespace from `~/.fl0w/tools`.
5. **Capability discovery** – skills, MCP servers, user tools, and `AGENTS.md`
   files are discovered into a `CapabilityCatalog` and surfaced in the UI where
   they can be selectively enabled/toggled.
6. **Render** – the `@opentui/core` CLI renderer boots and `createRoot()` renders
   `<App />` with the seeded messages and any initial error.
7. **Agent runtime** – `jevLoop()` orchestrates the state machine (`START` →
   `PLAN` / `DISCOVERY` → `EXECUTE` → `END`, with `REWIND`), running the graph
   nodes and hooks (`compactionHook`, `rewindState`).
8. **Shutdown** – an exit handler closes all MCP connections cleanly.
