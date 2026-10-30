# fl0w — Agent Guide

Guidance for AI coding agents (user docs: `README.md`). May be seeded into the conversation at runtime.

## Overview

An OpenTUI terminal app that connects to MCP servers and runs a conversational agent that plans,
executes, and distills tasks into reusable workflows.
Stack: TypeScript, Bun (`>=1.3.0`), React 19, OpenTUI, MCP SDK, Vercel `ai` SDK.

- **Config** — no app `config.json`; runtime defaults are constants in `src/constants.ts`.
  `ensureFl0wHome()` (`services/setup.ts`) scaffolds `FL0W_HOME` (`~/.fl0w`): `mcp.json`, `tools/`,
  `skills/`, `workspace/`.
- **Models** — each session has a `ModelSelection` (`models/agent.ts`) for `ROUTER` (decision model;
  default `typesafe-ai/jev`) and `DISCOVERY`/`PLAN`/`EXECUTE`/`SUMMARIZE` (default
  `deepseek/deepseek-v4.1-flash`). Unset phases fall back to `DEFAULT_MODELS` via `resolveModels()`;
  `/configure` edits the selection. Model list/metadata come from `/api/cli/ai/models`
  (`remote-api/ai-api.ts`, cached in `store/model-store.ts`); `contextWindowFor()` (fallback
  `DEFAULT_CONTEXT_WINDOW` = 1M) drives compaction and the usage meter. `MAX_ITERATIONS` (50) caps text
  subagent steps.
- **Auth** — `fl0w login`/`logout`/`whoami` via fl0w-work (`FL0W_API_URL`, default
  `https://www.fl0w.work`); tokens and MCP OAuth state live in `auth.json`. No client AI key:
  `index.tsx` sets `AI_SDK_DEFAULT_PROVIDER` to `fl0wModelProvider`, a gateway proxied through
  `/api/cli/ai` with the fl0w token. Model calls, the TUI, and headless agent commands require login.
- **Sync** — when signed in:
  - `mcp.json`/`auth.json` (`SYNC_FILENAMES`, `models/sync.ts`) reconcile at startup (`syncOnStartup()`,
    8s timeout); app-written `auth.json` changes push ~1s later (`watchLocalConfigWrites()`); manual
    edits sync at startup or via `fl0w sync`. `sync-state.json` (0600) stores the last agreed content;
    on conflict the newer file wins. fl0w account tokens never leave the machine.
  - Skills (mirrored to `~/.fl0w/skills`) and user tools sync both ways at startup
    (`sync-skills.ts`, `sync-tools.ts` → `bundle-sync.ts`): pushes send `x-base-content-hash` to reject
    stale writes; per-file merge (`bundle-merge.ts`) lets the newer side win, saving the loser to
    `~/.fl0w/sync-conflicts`; merge bases in `~/.fl0w/bundle-sync-state.json` (`bundle-state.ts`).
  - `fl0w sync` → `runFullSync()` (`sync/full-sync.ts`): config files, outbox flush, skills, tools.
- **Persistence** — sessions and workflows live on fl0w-work (`/api/sync/sessions`,
  `/api/sync/workflows`); no local DB. TUI writes go through the durable outbox (`sync/outbox.ts`,
  `FL0W_HOME/outbox`, one JSON file per write): pushes ~2s after a write, retries transient failures
  with backoff, discards permanent HTTP errors, drains at startup/exit; reads overlay unpushed writes.
  Headless commands emit transcripts but don't persist them.
- **MCP** — servers auto-connect at startup (with OAuth); failure only warns. On auth/connection
  tool-call failures, config is synced and the server reconnects once.
- **Capabilities** — skills, MCP servers, `AGENTS.md`, and user tools are toggleable.
  `services/capabilities.ts` builds the catalog (also `fl0w capabilities`), holds the selection
  (`getCapabilitySelection`/`applyCapabilitySelection`), and gates tools (`isCapabilityEnabled`/
  `isMcpToolEnabled`). Types (`CapabilityCatalog`/`CapabilityKind`/`CapabilitySelection`) live in
  `models/agent.ts`.
- **Skills** — discovered in `<workspace>/.agents/skills`, `~/.cursor/skills-cursor`,
  `~/.claude/skills`, `FL0W_HOME/skills`; loaded via `load_skill`.
- **User tools** — `userToolLoader.loadUserTools()` registers `FL0W_HOME/tools` in the `user`
  namespace (`external-tools/user-tool-service.ts`).
- **Front-loaded messages** — workspace instructions, enabled `AGENTS.md`, and the skills catalog seed
  the conversation (`agent/hooks/front-load.ts`); a running workflow adds step instructions
  (`activeWorkflowStore.set()`).
- **Tool output cap** — `executeNamedTool` (`agent/utils/tool-utils.ts`) truncates results over
  `TOOL_OUTPUT_MAX_CHARS` (20k). `capToolOutput()` saves full text to `FL0W_HOME/workspace/<sessionId>/`
  only when given a session id — the current adapter doesn't pass one, so full output isn't saved.
  `default/read_full_tool_output` reads saved outputs; compaction keeps their references; deleting a
  session removes its folder.
- **Workflows** — sessions distill into workflows (`/generate`, `/workflow`; headless `fl0w workflow`).

## Agent Loop

`agentLoop()` (`services/agent/agent-loop.ts`), per turn:

1. **ROUTER** — `routingAgent` (`experimental_decide`) picks `discovery`/`plan`/`execute`. Saved
   workflows skip straight to EXECUTE.
2. **DISCOVERY** (only if routed) — a pending `ask_question` ends the turn with `needs_input`.
3. **PLAN** (optional) → **EXECUTE** → `planCheckHook` (`hooks/plan-check.ts`) re-runs EXECUTE for
   steps not marked via `mark_step_complete`, up to `PLAN_CHECK_MAX_RETRIES` (2).
4. **SUMMARY**.

Each phase is a subagent in `services/agent/subagents/` with its own model and tool allowlist
(`toolpacks.ts`). Before DISCOVERY, PLAN, and EXECUTE only, `compactionHook` compacts the transcript
(using the SUMMARIZE model) when it exceeds `COMPACTION_TOKEN_THRESHOLD` of that phase's context window.

**Streaming** — `onStreamText` (live assistant text, `null` on commit) and `onPhase` (running subagent,
`null` at end). The TUI renders them below the transcript; headless `runHeadlessTurn()`
(`cli/cli-output.ts`) prints snapshot/message/`stream_delta`/`stream_end`/`phase`/usage/result JSON
lines. `fl0w session` exits `2` on `needs_input`.

## Startup & Shutdown

1. `index.tsx` scaffolds `FL0W_HOME` and dispatches `help`, account, `sync`, `workflow`, `session`,
   `capabilities`. Bare `fl0w` runs `requireLogin()` and `runStartupSync()`, then boots the TUI.
2. `tui.tsx`: `mcpClient.loadConfig()` + `connectAll()`; loads latest workspace session and all
   workflows; registers user tools; `buildCapabilityCatalog()` + `loadModels()` feed `/configure`.
3. `@opentui/core` renders `<App />`; applying a capability selection seeds front-load messages.
4. Exit closes MCP connections (headless awaits close); headless runs end with `finishHeadlessRun()`,
   awaiting config pushes and the outbox flush.

## Structure

```
src/
├── index.tsx          # Entry – scaffolds FL0W_HOME, dispatches CLI vs TUI
├── tui.tsx            # TUI startup – MCP connect, session/workflow load, renderer
├── constants.ts       # Shared constants (FL0W_HOME, OUTBOX_DIR, FL0W_API_URL, DEFAULT_MODELS)
├── cli/               # Headless commands + JSON-lines output
├── models/            # agent, auth, mcp, session, sync, ui, workflow types
├── store/             # In-memory stores, remote session/workflow/model access
├── services/
│   ├── agent/         # agent-loop, subagents, toolpacks, hooks, default-tools, utils
│   ├── auth/          # login/logout/whoami, auth-service
│   ├── external-tools/ # mcp-client, oauth-provider, user-tool-service, callback-server
│   ├── remote-api/    # fl0w-work HTTP: ai-api, sync-api
│   ├── sync/          # config sync, bundle sync, full-sync, outbox, sync-state
│   ├── workflow/      # generate & extract tool calls
│   ├── capabilities.ts
│   └── setup.ts       # ensureFl0wHome, requireLogin, startup sync, headless teardown
└── ui/                # App, hooks, lib, components
```

## Conventions

- Models/types → `src/models/`; logic → `src/services/`; UI → `src/ui/`; shared values → `src/constants.ts`.
- Prefer explicit types over `any`, one-line `if`s where they fit, **inline logic over one-off
  helpers**, and reusing existing files over new ones.
- Tests are colocated `*.test.ts` (`bun:test`).
- **Read before editing** — `index.tsx`, `tui.tsx`, `services/setup.ts`, and
  `external-tools/mcp-client.ts` before touching startup/config/connections; `agent-loop.ts` before
  touching the agent runtime.
- **Failure-tolerant** — never crash on missing MCP config; surface UI warnings.
- **Graceful shutdown** — MCP-touching code must respect the clean-close-on-exit path.
- **Verify** — run `bun run lint` and `bun test`, and confirm `bun dev` boots.
