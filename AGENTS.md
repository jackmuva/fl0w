# fl0w — Agent Guide

Guidance for AI coding agents in this repo (user docs live in `README.md`).
May seed workspace instructions into the conversation at runtime.

## Overview

A terminal (TUI) app built on **OpenTUI** that connects to MCP servers and runs a
conversational agent that plans, executes, and distills tasks into reusable workflows.

- **Stack** — TypeScript, Bun (`>=1.3.0`), React 19, OpenTUI, MCP SDK, Vercel `ai` SDK.
- **Config** — there is no `config.json`; runtime values are constants in `src/constants.ts`
  and models are chosen per session. `ensureFl0wHome()` (`services/setup.ts`) scaffolds
  `FL0W_HOME` (`~/.fl0w`) with `mcp.json`, `tools/`, `skills/`, and `workspace/`.
- **Models** — each session carries a `ModelSelection` (`models/ai-model.ts`) over five phases:
  `ROUTER` (a decision model), `DISCOVERY`, `PLAN`, `EXECUTE`, `SUMMARIZE` (text models). Unset
  phases fall back to `DEFAULT_MODELS` via `resolveModels()` in `agent-loop.ts`; the TUI's
  `/configure` dialog edits the selection. The model list and per-model context windows come
  from fl0w-work's `/api/cli/ai/models` route (`services/model-registry.ts` → `remote-api/ai-api.ts`
  `listModels()`); metadata includes per-model context windows and input token prices. `contextWindowFor()`
  falls back to `DEFAULT_CONTEXT_WINDOW` (200,000) and drives compaction thresholds and the UI usage meter.
  `MAX_ITERATIONS` (50) caps steps per phase;
  `TOOL_OUTPUT_MAX_CHARS` (20,000) caps inline tool results.
- **Auth** — `fl0w login`/`logout`/`whoami` sign in via fl0w-work (`FL0W_API_URL` →
  `https://www.fl0w.work`); tokens + MCP OAuth state live in `auth.json`. There is no AI Gateway key
  on the client: `index.tsx` sets `AI_SDK_DEFAULT_PROVIDER` to `fl0wModelProvider` (`services/auth/token.ts`),
  a gateway provider pointed at fl0w-work's `/api/cli/ai` proxy and authenticated with the fl0w access token,
  so every model id string resolves through it. Model calls require `fl0w login`.
- **Config sync** — when signed in, `mcp.json` and `auth.json` (`SYNC_FILENAMES` in `models/sync.ts`)
  sync with fl0w-work: reconciled at startup (`syncOnStartup()`, 8s timeout) and pushed ~1s after local
  writes (`watchLocalConfigWrites()`); `sync-state.json` (0600) records the last agreed content, and the
  newer copy wins when both sides changed. Enabled skills and user tools upload separately
  (`services/sync/sync-skills.ts`, `services/sync/sync-tools.ts`); `fl0w sync` runs `runFullSync()`
  (`services/sync/full-sync.ts`): config files, outbox flush, then every local skill and tool.
- **MCP** — servers auto-connect at startup (with OAuth); failure is non-fatal (UI warning).
  On auth/connection tool-call failures, syncs config and reconnects once.
- **Front-loaded messages** — workspace instructions, enabled `AGENTS.md` content, and the skills
  catalog seed the conversation (`services/agent/hooks/front-load.ts`); a running workflow adds its
  step instructions (`activeWorkflowStore.set()`).
- **Capabilities** — skills, MCP servers, `AGENTS.md`, and user tools are discoverable/toggleable.
  `services/capabilities.ts` builds the catalog (also backs `fl0w capabilities`), holds the active
  selection (`getCapabilitySelection` / `applyCapabilitySelection`), and gates tools via
  `isCapabilityEnabled` / `isMcpToolEnabled`.
- **Tool output cap** — `executeNamedTool` (`services/agent/utils/tool-utils.ts`) truncates results over
  `TOOL_OUTPUT_MAX_CHARS` (20,000) and writes the full text to `FL0W_HOME/workspace/<sessionId>/`;
  the model reads it back via `default/read_full_tool_output`.
  Compaction lists every saved file in its summary; deleting a session removes its workspace folder.
- **Persistence** — sessions and workflows live on fl0w-work (`/api/sync/sessions`, `/api/sync/workflows`); there is no local DB, so the TUI and headless runs require `fl0w login`. Reads go through `services/session/session-repo.ts` and `services/workflow/workflow-repo.ts`. Writes go to the durable outbox (`services/sync/outbox.ts`, `OUTBOX_DIR` → `FL0W_HOME/outbox`, one JSON file per pending write), which pushes ~2s after writes settle, retries with backoff, and drains at startup and on exit; reads overlay unpushed writes.
- **Workflows** — sessions distill into reusable workflows (`/generate`, `/workflow`; headless `fl0w workflow`).
- **Skills** — discovered in `<workspace>/.agents/skills`, `~/.cursor/skills-cursor`, `~/.claude/skills`,
  and `FL0W_HOME/skills`; loaded via the `load_skill` tool.
- **User tools** — `userToolLoader.loadUserTools()` registers custom tools from `FL0W_HOME/tools` in the `user` namespace (`services/external-tools/user-tool-service.ts`).
- **Agent loop** — `agentLoop()` in `src/services/agent/agent-loop.ts`. `routingAgent` (the `ROUTER`
  decision model, `experimental_decide`) picks `discovery`/`plan`/`execute` per turn; the turn then runs
  DISCOVERY (skipped unless routed there; returns early on a pending `ask_question`), PLAN, EXECUTE, and a
  closing SUMMARY phase, each a subagent in `services/agent/subagents/` with its own model and tool
  allowlist (`toolpacks.ts`). `compactionHook` rewrites the transcript before each phase once it exceeds
  `COMPACTION_TOKEN_THRESHOLD` of that phase model's context window.
  After EXECUTE, `planCheckHook` (`hooks/plan-check.ts`) re-runs EXECUTE with a reminder listing plan steps
  never marked via `mark_step_complete`, up to `PLAN_CHECK_MAX_RETRIES` (2) times.
- **Streaming** — `agentLoop` options take `onStreamText`, a live preview of assistant text as it generates
  (`null` once committed), and `onPhase`, the running subagent (`null` at end). The TUI renders them
  below the transcript; headless `session`/`workflow` print them as `stream_delta`/`stream_end` and
  `phase` JSON lines (`cli/cli-output.ts` `runHeadlessTurn`).
- **Shutdown** — MCP connections close cleanly on exit; headless commands end with `finishHeadlessRun()`,
  which flushes pending config pushes, skill mirrors, and the outbox.

## Structure

```
src/
├── index.tsx          # Entry – scaffolds FL0W_HOME, dispatches CLI commands vs TUI
├── tui.tsx            # TUI startup – MCP connect, session/workflow load, renderer
├── constants.ts       # Shared constants (FL0W_HOME, OUTBOX_DIR, FL0W_API_URL, DEFAULT_MODELS)
├── cli/               # Headless commands (help, sync, session, workflow) + JSON-lines output
├── models/            # agent, ai-model, auth, mcp, session, sync, ui, workflow types
├── services/          # Business logic
│   ├── agent/         # agent-loop, subagents, toolpacks, hooks, default-tools, user-tools, utils
│   ├── auth/          # login/logout/whoami, token.ts, auth-store, callback-server
│   ├── external-tools/ # mcp-client, oauth-provider, user-tool-service, callback-server
│   ├── remote-api/    # fl0w-work HTTP: ai-api (model list), sync-api
│   ├── session/       # session records + fl0w-work session repo
│   ├── skills/        # skill mirroring + sync with fl0w-work
│   ├── sync/          # config-file sync, full-sync, outbox, sync-state
│   ├── workflow/      # generate & extract tool calls
│   ├── capabilities.ts     # catalog, selection, `fl0w capabilities`
│   ├── model-registry.ts   # fl0w-work model list cache + contextWindowFor
│   └── setup.ts            # ensureFl0wHome, requireLogin, startup sync, headless teardown
└── ui/                # App, hooks, lib, components
```

## How It Works

1. `ensureFl0wHome()` scaffolds `FL0W_HOME`; `index.tsx` dispatches `help`, account commands,
   `sync`, `workflow`, `session`, and `capabilities` up front. Bare `fl0w` requires login
   (`requireLogin()`) and reconciles config with fl0w-work (`runStartupSync()`) before booting the TUI.
2. `tui.tsx` runs `mcpClient.loadConfig()` + `connectAll()` (optional OAuth); failures warn, never crash.
3. The latest workspace session and all workflows load from fl0w-work; `userToolLoader.loadUserTools()` registers
   `user` namespace tools; `buildCapabilityCatalog()` and `loadModels()` feed the `/configure` dialog.
4. `@opentui/core` boots and `<App />` renders the session. Applying a capability selection seeds
   front-load messages (workspace instructions, enabled `AGENTS.md`, skills catalog).
5. Each turn, `agentLoop()` runs ROUTING → optional DISCOVERY (a pending `ask_question` ends the turn
   with `needs_input`) → PLAN → EXECUTE → SUMMARY, compacting before each phase.
6. Headless turns go through `runHeadlessTurn()` (`cli/cli-output.ts`), printing
   snapshot/message/stream/phase/result JSON lines; `fl0w session` exits `2` on `needs_input`.
7. Exit closes all MCP connections; headless runs also flush pending sync writes.

## Conventions

- TypeScript; run `bun run lint` before finishing.
- Prefer explicit types over `any`; use one-line `if`s where they fit.
- **Prefer inline logic over one-off helper methods.**
- Reuse existing files over creating new ones.
- Models/types → `src/models/`; business logic → `src/services/`; UI → `src/ui/`; shared values → `src/constants.ts`.
- Tests are colocated `*.test.ts` (`bun:test`); run `bun test`.

## Agent Instructions

- **Read before editing** — understand `src/index.tsx`, `src/tui.tsx`, `src/services/setup.ts`,
  and `src/services/external-tools/mcp-client.ts` before touching startup, config, or connection logic;
  `src/services/agent/agent-loop.ts` before touching the agent runtime.
- **Runtime constants** — plain exports in `src/constants.ts`; per-session models resolve via
  `resolveModels()` against `DEFAULT_MODELS`, not config files.
- **Failure-tolerant** — never crash on missing MCP config; surface UI warnings.
- **Capability types** — import `CapabilityCatalog`/`CapabilityKind`/`CapabilitySelection`
  from `src/models/agent.ts`; catalog and active selection live in `src/services/capabilities.ts`.
- **Graceful shutdown** — MCP-touching code must respect the clean-close-on-exit path.
- **Verify** — after changes run `bun run lint` and confirm `bun dev` boots.
