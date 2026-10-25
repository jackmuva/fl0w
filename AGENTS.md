# fl0w — Agent Guide

Guidance for AI coding agents in this repo (user docs live in `README.md`).
May seed workspace instructions into the conversation at runtime.

## Overview

A terminal (TUI) app built on **OpenTUI** that connects to MCP servers and runs a
conversational agent that plans, executes, and distills tasks into reusable workflows.

- **Stack** — TypeScript, Bun (`>=1.3.0`), React 19, OpenTUI, MCP SDK, Vercel `ai` SDK.
- **Config** — `config.json` in `FL0W_HOME` (`~/.fl0w`); `loadAppConfig()` applies it via `applyAppConfig()` into runtime exports in `constants.ts`.
- **Models** — `LLM_MODEL` (from `llmModel`, default `deepseek/deepseek-v4.1-flash`); `DECISION_MODEL` (from `decisionModel`, default `typesafe-ai/jev`) drives agent planning/choices.
  `AGENT_MODE` (from `mode`, default `decision`) selects the runtime: `decision` is the
  evaluate/rewind graph; `llm` is a standard tool-calling loop on `LLM_MODEL`.
  `CONTEXT_WINDOW` (from `contextWindow`, default `232000`) drives compaction thresholds and the UI usage meter.
  `MAX_ITERATIONS` (from `maxIterations`, default `50`) caps agent loop iterations per turn.
  `TOOL_OUTPUT_MAX_CHARS` (from `toolOutputMaxChars`, default `20000`) caps inline tool results.
- **Auth** — `fl0w login`/`logout`/`whoami` sign in via fl0w-work (`FL0W_API_URL` →
  `https://www.fl0w.work`); tokens + MCP OAuth state live in `auth.json`. There is no AI Gateway key
  on the client: `index.tsx` sets `AI_SDK_DEFAULT_PROVIDER` to `fl0wModelProvider` (`services/auth/token.ts`),
  a gateway provider pointed at fl0w-work's `/api/cli/ai` proxy and authenticated with the fl0w access token,
  so every model id string resolves through it. Model calls require `fl0w login`.
- **Config sync** — when signed in, `config.json`, `mcp.json`, `auth.json` sync with fl0w-work:
  reconciled at startup and after `fl0w login`, pushed ~1s after writes; when a file changed on both
  sides since the last sync (`sync-state.json`, 0600), the newer copy wins. Disable per device with `"sync": false` in `config.json` (never synced itself).
- **MCP** — servers auto-connect at startup (with OAuth); failure is non-fatal (UI warning).
  On auth/connection tool-call failures, syncs config and reconnects once when config sync is enabled.
- **Front-loaded messages** — workspace instructions, enabled `AGENTS.md` content, and the skills
  catalog seed the conversation before the UI boots.
- **Capabilities** — skills, MCP servers, `AGENTS.md`, and user tools are discoverable/toggleable.
- **Tool output cap** — `executeNamedTool` truncates results over `TOOL_OUTPUT_MAX_CHARS` (`toolOutputMaxChars`, default `20000`)
  and writes the full text to `FL0W_HOME/workspace/<sessionId>/`; the model reads it back via `default/read_full_tool_output`.
  Compaction lists every saved file in its summary; deleting a session removes its workspace folder.
- **Persistence** — sessions and workflows live on fl0w-work (`/api/sync/sessions`, `/api/sync/workflows`); there is no local DB, so the TUI and headless runs require `fl0w login`. Reads go through `services/session/session-repo.ts` and `services/workflow/workflow-repo.ts`. Writes go to the durable outbox (`services/sync/outbox.ts`, `OUTBOX_DIR` → `FL0W_HOME/outbox`, one JSON file per pending write), which pushes ~2s after writes settle, retries with backoff, and drains at startup and on exit; reads overlay unpushed writes.
- **Workflows** — sessions distill into reusable workflows (`/generate-workflow`, `/run-workflow`).
- **Skills** — found in `./skills`, `FL0W_HOME/skills`, `~/.cursor/skills-cursor`; loaded via `load_skill`.
- **User tools** — `loadUserTools()` registers custom tools from `FL0W_HOME/tools` in the `user` namespace.
- **Agent graph** — `fl0wLoop()` in `src/services/agent/main-loop.ts` dispatches on `mode`: decision state machine
  (`START` → `PLAN`/`DISCOVERY` → `EXECUTE` → `END`, with `REWIND`) in
  `src/services/agent/loops/graph.ts`, or LLM tool-calling loop in `src/services/agent/loops/llm-loop.ts`.
- **Streaming** — `fl0wLoop` options take `onStreamText`, a live preview of assistant text as it generates
  (LLM-mode text; decision-mode `message_answer`/`create_plan` tool inputs); `null` once committed. The TUI renders it
  below the transcript; headless `session`/`workflow` print it as `stream_delta`/`stream_end` JSON lines, and the running subagent
  (the TUI's active phase, from `onPhase`) as `phase` lines (`cli/cli-output.ts` `runHeadlessTurn`).
- **Shutdown** — MCP connections close cleanly on exit.

## Structure

```
src/
├── index.tsx          # Entry – loads config, initializes MCP/tools, renders TUI
├── constants.ts       # Shared constants (FL0W_HOME, OUTBOX_DIR, FL0W_API_URL, DEFAULT_MODELS)
├── models/            # agent, config, mcp, ui, workflow types
├── services/          # Business logic
│   ├── agent/         # loop, capabilities, graph, prompt, built-in & user tools, hooks
│   ├── auth/          # login/logout/whoami, token.ts, callback-server
│   ├── config/        # app-config (loadAppConfig, ensureFl0wHome)
│   ├── mcp/           # mcp-client, oauth-provider
│   ├── session/       # session records + fl0w-work session repo
│   ├── sync/          # fl0w-work config/mcp/auth sync, session/workflow outbox
│   ├── workflow/      # generate & extract tool calls
│   └── session/
└── ui/                # App, hooks, lib, components
```

## How It Works

1. `ensureFl0wHome()` scaffolds `FL0W_HOME`; CLI account commands dispatch up front;
   `loadAppConfig()` populates env. Messages front-load so the UI renders immediately.
2. Workspace instructions, enabled `AGENTS.md`, and the skills catalog seed the conversation.
3. `mcpClient.loadConfig()` + `connectAll()` connect all servers (optional OAuth); failures warn.
4. `loadUserTools()` registers `user` namespace tools.
5. Skills/servers/tools/`AGENTS.md` load into a togglable `CapabilityCatalog`.
6. `@opentui/core` boots and `<App />` renders seeded messages.
7. `fl0wLoop()` runs the selected runtime (`loops/graph.ts` + `rewindState` in decision mode,
   `loops/llm-loop.ts` in LLM mode) with shared hooks (`compactionHook`, front-load, session-usage).
8. Exit handler closes all MCP connections.

## Conventions

- TypeScript; run `bun run lint` before finishing.
- Prefer explicit types over `any`; use one-line `if`s where they fit.
- **Prefer inline logic over one-off helper methods.**
- Reuse existing files over creating new ones.
- Models/types → `src/models/`; business logic → `src/services/`; UI → `src/ui/`; shared values → `src/constants.ts`.

## Agent Instructions

- **Read before editing** — understand `src/index.tsx`, `src/services/config/app-config.ts`,
  and `src/services/mcp/mcp-client.ts` before touching startup, config, or connection logic.
- **Config-driven runtime constants** — map a `config.json` field to a default in
  `src/constants.ts` and refresh it from `applyAppConfig()` in `loadAppConfig()`.
- **Failure-tolerant** — never crash on missing MCP config; surface UI warnings.
- **Capability types** — import `CapabilityCatalog`/`CapabilityKind`/`CapabilitySelection`
  from `src/models/agent.ts`, not `src/services/agent/capabilities.ts`.
- **Graceful shutdown** — MCP-touching code must respect the clean-close-on-exit path.
- **Verify** — after changes run `bun run lint` and confirm `bun dev` boots.
