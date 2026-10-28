# fl0w — Agent Guide

Guidance for AI coding agents in this repo (user docs live in `README.md`).
May seed workspace instructions into the conversation at runtime.

## Overview

A terminal (TUI) app built on **OpenTUI** that connects to MCP servers and runs a
conversational agent that plans, executes, and distills tasks into reusable workflows.

- **Stack** — TypeScript, Bun (`>=1.3.0`), React 19, OpenTUI, MCP SDK, Vercel `ai` SDK.
- **Config** — there is no active app-settings `config.json`; runtime defaults are constants in
  `src/constants.ts` and models are chosen per session. `ensureFl0wHome()` (`services/setup.ts`)
  scaffolds `FL0W_HOME` (`~/.fl0w`) with `mcp.json`, `tools/`, `skills/`, and `workspace/`.
- **Models** — each session carries a `ModelSelection` (`models/agent.ts`) over five phases:
  `ROUTER` (a decision model), `DISCOVERY`, `PLAN`, `EXECUTE`, `SUMMARIZE` (text models). Unset
  phases fall back to `DEFAULT_MODELS` via `resolveModels()` in `agent-loop.ts`; the TUI's
  `/configure` dialog edits the selection. Defaults are `typesafe-ai/jev` for ROUTER and
  `deepseek/deepseek-v4.1-flash` for the other phases. The model list and metadata come from
  fl0w-work's `/api/cli/ai/models` route (`services/remote-api/ai-api.ts` `listModels()`), cached by
  `store/model-store.ts`; metadata includes context windows and input prices. `contextWindowFor()` falls back to
  `DEFAULT_CONTEXT_WINDOW` (1,000,000) and drives compaction thresholds and the UI usage meter.
  `MAX_ITERATIONS` (50) caps generation steps for text subagents;
  `TOOL_OUTPUT_MAX_CHARS` (20,000) caps inline tool results.
- **Auth** — `fl0w login`/`logout`/`whoami` sign in via fl0w-work (`FL0W_API_URL` →
  `https://www.fl0w.work`); account tokens + MCP OAuth state live in `auth.json`. There is no AI Gateway key
  on the client: `src/index.tsx` sets `AI_SDK_DEFAULT_PROVIDER` to `fl0wModelProvider`,
  a gateway provider pointed at fl0w-work's `/api/cli/ai` proxy and authenticated with the fl0w access token,
  so every model id string resolves through it. Model calls require `fl0w login`.
- **Config sync** — when signed in, `mcp.json` and `auth.json` (`SYNC_FILENAMES` in `models/sync.ts`)
  sync with fl0w-work: reconciled at startup (`syncOnStartup()`, 8s timeout); app-generated `auth.json`
  writes are pushed ~1s later (`watchLocalConfigWrites()`), while manual config edits sync at startup or
  via `fl0w sync`. Local fl0w account tokens are excluded from the remote `auth.json`.
  `sync-state.json` (0600) records the last agreed content; when both copies changed, the newer file wins
  (the fl0w account token remains local). Every discovered skill (mirrored into `~/.fl0w/skills`) and user tool syncs both ways in the
  background at startup (`services/sync/sync-skills.ts`, `services/sync/sync-tools.ts`), regardless of workflow use: `services/sync/bundle-sync.ts`
  pulls, pushes (with `x-base-content-hash` so fl0w-work refuses a stale push), and merges per file (`bundle-merge.ts`, newer side wins a
  conflict, loser saved in `~/.fl0w/sync-conflicts`), with merge bases in `~/.fl0w/bundle-sync-state.json` (`bundle-state.ts`); `fl0w sync` runs `runFullSync()`
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
  `TOOL_OUTPUT_MAX_CHARS` (20,000). `capToolOutput()` saves the full text under
  `FL0W_HOME/workspace/<sessionId>/` only when its caller supplies a session id; the current agent tool
  adapter does not supply one, so oversized results report that the full output was not saved.
  `default/read_full_tool_output` can read saved outputs where available. Compaction preserves references
  to saved outputs, and deleting a session removes its workspace folder.
- **Persistence** — TUI sessions and workflows live on fl0w-work (`/api/sync/sessions`, `/api/sync/workflows`); there is no local database, so the TUI and headless agent commands require `fl0w login`. Stores live under `src/store/`. TUI writes go to the durable outbox (`services/sync/outbox.ts`, `OUTBOX_DIR` → `FL0W_HOME/outbox`, one JSON file per pending write), which pushes ~2s after writes enter the outbox, retries temporary failures with backoff, and drains at startup and on exit; permanent HTTP errors are discarded, and reads overlay unpushed writes. Headless commands emit transcripts but do not persist them through the CLI.
- **Workflows** — sessions distill into reusable workflows (`/generate`, `/workflow`; headless `fl0w workflow`).
- **Skills** — discovered in `<workspace>/.agents/skills`, `~/.cursor/skills-cursor`, `~/.claude/skills`,
  and `FL0W_HOME/skills`; loaded via the `load_skill` tool.
- **User tools** — `userToolLoader.loadUserTools()` registers custom tools from `FL0W_HOME/tools` in the `user` namespace (`services/external-tools/user-tool-service.ts`).
- **Agent loop** — `agentLoop()` in `src/services/agent/agent-loop.ts`. `routingAgent` (the `ROUTER`
  decision model, `experimental_decide`) picks `discovery`/`plan`/`execute` per turn; the turn then runs
  DISCOVERY (skipped unless routed there; returns early on a pending `ask_question`), PLAN, EXECUTE, and a
  closing SUMMARY phase, each a subagent in `services/agent/subagents/` with its own model and tool
  allowlist (`toolpacks.ts`). Before DISCOVERY, PLAN, and EXECUTE, `compactionHook` may rewrite the transcript
  when it exceeds `COMPACTION_TOKEN_THRESHOLD` of that phase model's context window; it uses the SUMMARIZE
  model to create the compacted summary. It does not compact before ROUTING or SUMMARY.
  After EXECUTE, `planCheckHook` (`hooks/plan-check.ts`) re-runs EXECUTE with a reminder listing plan steps
  never marked via `mark_step_complete`, up to `PLAN_CHECK_MAX_RETRIES` (2) times.
- **Streaming** — `agentLoop` options take `onStreamText`, a live preview of assistant text as it generates
  (`null` once committed), and `onPhase`, the running subagent (`null` at end). The TUI renders them
  below the transcript; headless `session`/`workflow` print them as `stream_delta`/`stream_end` and
  `phase` JSON lines (`cli/cli-output.ts` `runHeadlessTurn`).
- **Shutdown** — exit cleanup initiates closing MCP connections (headless commands explicitly await close); headless
  commands end with `finishHeadlessRun()`, which awaits config pushes
  and the durable outbox flush.

## Structure

```
src/
├── index.tsx          # Entry – scaffolds FL0W_HOME, dispatches CLI commands vs TUI
├── tui.tsx            # TUI startup – MCP connect, session/workflow load, renderer
├── constants.ts       # Shared constants (FL0W_HOME, OUTBOX_DIR, FL0W_API_URL, DEFAULT_MODELS)
├── cli/               # Headless commands (help, sync, session, workflow) + JSON-lines output
├── models/            # agent, auth, mcp, session, sync, ui, workflow types
├── store/             # In-memory stores and remote session/workflow/model access
├── services/          # Business logic
│   ├── agent/         # agent-loop, subagents, toolpacks, hooks, default-tools, utils
│   ├── auth/          # login/logout/whoami and auth-service
│   ├── external-tools/ # mcp-client, oauth-provider, user-tool-service, callback-server
│   ├── remote-api/    # fl0w-work HTTP: ai-api (model list), sync-api
│   ├── sync/          # config-file sync, full-sync, outbox, sync-state
│   ├── workflow/      # generate & extract tool calls
│   ├── capabilities.ts     # catalog, selection, `fl0w capabilities`
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
   with `needs_input`) → optional PLAN → EXECUTE (with plan-completion checks) → SUMMARY. It checks for
   compaction before DISCOVERY, PLAN, and EXECUTE, not before every phase. Saved workflows skip routing,
   discovery, and planning and go directly to EXECUTE.
6. Headless turns go through `runHeadlessTurn()` (`cli/cli-output.ts`), printing
   snapshot/message/stream/phase/usage/result JSON lines; `fl0w session` exits `2` on `needs_input`.
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
