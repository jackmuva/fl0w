# fl0w — Agent Guide

Guidance for AI coding agents working in this repo. Sits alongside `README.md`
(user docs) and `.cursor/` / `.claude/` tool config. May be discovered at
runtime to seed workspace instructions into the conversation.

---

## Overview

A terminal (TUI) app built on **OpenTUI** that connects to MCP servers and
renders a conversational agent that plans, executes tasks, and can be distilled
into reusable workflows.

Key facts:
- **Stack** — TypeScript, Bun (`>=1.3.0`), React 19, OpenTUI, `@modelcontextprotocol/sdk`, Vercel `ai` SDK.
- **Config** — `config.json` in `JEV_HOME` (`~/.fl0w`) drives the app; fields
  (e.g. `aiGatewayApiKey`, `llmModel`) load into `process.env` at startup.
- **Agent model** — `LLM_MODEL` env (from `llmModel`, default `deepseek/deepseek-v4-flash`);
  `SYSTEM_ONE_MODEL` (default `typesafe-ai/jev`) drives planning.
- **MCP** — configured servers auto-connect at startup (with OAuth); failure is
  non-fatal (UI warning).
- **Front-loaded messages** — workspace instructions, enabled `AGENTS.md` content,
  and skills catalog seed the conversation before the UI boots.
- **Capabilities** — skills, MCP servers, `AGENTS.md`, and user tools are
  discovered and selectable from the UI.
- **Persistence** — sessions in SQLite (`DB_PATH` → `JEV_HOME/fl0w-sqlite.db`,
  resume via `/resume`); workflows stored separately.
- **Workflows** — sessions distill into reusable workflows (`/generate-workflow`
  `/run-workflow`) with required capabilities.
- **Skills** — discovered from `./skills`, `JEV_HOME/skills`, `~/.cursor/skills-cursor`;
  loaded via the `load_skill` tool.
- **User tools** — custom tools registered via `loadUserTools()` from `JEV_HOME/tools`
  in the `user` namespace.
- **Agent graph** — state machine (`START` → `PLAN`/`DISCOVERY` → `EXECUTE` → `END`,
  with `REWIND`) run by `jevLoop()` and nodes in `src/services/agent/graph.ts`.
- **Graceful shutdown** — MCP connections close cleanly on exit.

---

## Commands

| Command                             | Description                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `bun install`                       | Install dependencies (first).                                        |
| `bun dev`                           | Run in watch mode (`bun run --watch src/index.tsx`).                 |
| `bun run lint`                      | Typecheck without emitting (`tsc --noEmit`).                         |
| `bun run build`                     | Compile local executable (`bun build --compile --outfile fl0w`).     |
| `bun run install:opentui-platforms` | Add all-platform/all-cpu `@opentui/core` (for cross-builds).         |
| `bun run build:linux-x64`           | Cross-compile → `dist/fl0w-linux-x64`.                              |
| `bun run build:linux-arm64`         | Cross-compile → `dist/fl0w-linux-arm64`.                            |
| `bun run build:linux-x64-musl`      | Cross-compile → `dist/fl0w-linux-x64-musl`.                         |
| `bun run build:linux-arm64-musl`    | Cross-compile → `dist/fl0w-linux-arm64-musl`.                       |
| `bun run build:darwin-x64`          | Cross-compile → `dist/fl0w-darwin-x64`.                             |
| `bun run build:darwin-arm64`        | Cross-compile → `dist/fl0w-darwin-arm64`.                           |
| `bun run build:windows-x64`         | Cross-compile → `dist/fl0w-windows-x64.exe`.                        |
| `bun run build:all`                 | Install all platforms, then build every target.                     |

Artifacts land in `dist/`. The local build produces `./fl0w`.

---

## Structure

```
src/
├── index.tsx          # Entry – loads config, initializes MCP/tools, renders TUI
├── constants.ts       # Shared constants (JEV_HOME, LLM_MODEL, SYSTEM_ONE_MODEL, DB_PATH)
├── db/                # session-store.ts, workflow-store.ts (+ tests)
├── models/            # agent.ts, config.ts, mcp.ts, ui.ts, workflow.ts
├── services/
│   ├── agent/         # agent-loop.ts, capabilities.ts, graph.ts, prompt.ts
│   │   ├── default-tools/ # built-in tools (apply-patch, bash, read-file, …)
│   │   ├── hooks/         # front-load.ts, compaction.ts, rewind.ts (+ tests/fixtures)
│   │   ├── user-tools/    # loader.ts
│   │   └── utils/
│   ├── auth/           # fl0w login, auth-store.ts (auth.json), callback-server.ts, gateway-provider.ts
│   ├── config/app-config.ts   # loadAppConfig(), ensureJevHome()
│   ├── mcp/            # mcp-client.ts, oauth-provider.ts
│   ├── workflow/       # build-message.ts, extract-tool-calls.ts, generate.ts
│   └── session/
└── ui/                 # App.tsx, hooks/, lib/, components/
```

---

## How It Works

1. **Startup** — `ensureJevHome()` scaffolds `JEV_HOME` (`config.json`, `mcp.json`,
   `tools/`); `loadAppConfig()` reads config and populates env vars. `auth.json` holds
   `fl0w login` tokens and MCP OAuth state.
   Messages front-loaded so the UI renders immediately.
2. **Front-loading** — workspace instructions, enabled `AGENTS.md` content, and the
   skills catalog (via `discoverSkills()`, `discoverAgentsMd()`) seed the conversation.
3. **MCP connect** — `mcpClient.loadConfig()` + `connectAll()` connect all servers
   (optional OAuth). Failures show a UI warning, never crash.
4. **Tools** — `loadUserTools()` registers custom tools in the `user` namespace.
5. **Capabilities** — skills/servers/tools/`AGENTS.md` discovered into a
   `CapabilityCatalog`, toggleable in the UI.
6. **Render** — `@opentui/core` boots and `<App />` renders with seeded messages.
7. **Agent runtime** — `jevLoop()` runs the state machine and hooks
   (`compactionHook`, `rewindState`).
8. **Shutdown** — exit handler closes all MCP connections cleanly.

---

## Conventions

- TypeScript throughout; run `bun run lint` before finishing.
- Prefer explicit types over `any`.
- Use one-line `if`s where they fit.
- **Prefer inline logic over creating new helper methods.** New helpers that are
  used only once are discouraged.
- Reuse existing files over creating new ones.
- Models/types → `src/models/`; business logic → `src/services/`; UI → `src/ui/`;
  shared values → `src/constants.ts`.

---

## Agent Instructions

- **Read before editing** — understand `src/index.tsx`,
  `src/services/config/app-config.ts`, and `src/services/mcp/mcp-client.ts`
  before touching startup, config, or connection logic.
- **Config-driven env vars** — mirror `loadAppConfig()`: map a `config.json` field
  to `process.env` with a sensible default in `src/constants.ts`.
- **Failure-tolerant design** — never crash on missing MCP config; surface UI warnings.
- **Capability types** — import `CapabilityCatalog`/`CapabilityKind`/`CapabilitySelection`
  from `src/models/agent.ts`, not `src/services/agent/capabilities.ts`.
- **Preserve graceful shutdown** — MCP-touching code must respect the clean-close-on-exit path.
- **Verify** — after changes run `bun run lint` and confirm `bun dev` boots.
