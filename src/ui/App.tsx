import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { llmLoop, resolveModels } from "../services/agent/llm-loop"
import {
  getCapabilitySelection,
  emptyCapabilitySelection,
  isCatalogEmpty,
  mergeCapabilitySelection,
} from "../services/agent/config"
import { findPendingAskQuestion } from "../services/agent/utils/ask-question"
import { fl0wMessage } from "../services/agent/utils/fl0w-message"
import { listAllTools } from "../services/agent/utils/tools"
import { setActiveWorkflow } from "../services/agent/hooks/front-load"
import { buildWorkflowPlanMessages, buildWorkflowUserMessage } from "../services/workflow/build-message"
import { generateWorkflowFromSession, WorkflowGenerationError } from "../services/workflow/generate"
import { deleteWorkflow, listWorkflows, saveWorkflow } from "../services/workflow/workflow-repo"
import { flushOutbox } from "../services/sync/outbox"
import { flushPendingSkillMirrorsInBackground } from "../services/skills/mirror-enabled-skills"
import type { WorkflowRecord } from "../models/workflow"
import type { SessionListEntry, StoredSession } from "../models/session"
import { useSessionPersistence } from "./hooks/useSessionPersistence"
import { buildPlanProgress, buildToolCallInputMap, type PlanProgress } from "./lib/format/message"
import { PlanSidebar, PLAN_SIDEBAR_MIN_TERMINAL_WIDTH } from "./components/plan/PlanSidebar"
import { Transcript } from "./components/transcript/Transcript"
import { CompletionOverlayDialog } from "./components/input/CompletionOverlayDialog"
import { SessionSelectionDialog } from "./components/session/SessionSelectionDialog"
import { WorkflowSelectionDialog } from "./components/workflow/WorkflowSelectionDialog"
import { ChatInput } from "./components/input/ChatInput"
import { ClarifyQuestionBox } from "./components/primitives/ClarifyQuestionBox"
import { ContextCostStatusBar } from "./components/primitives/ContextCostStatusBar"
import { WorkingIndicator } from "./components/primitives/WorkingIndicator"
import { Mascot } from "./components/primitives/Mascot"
import { useCopyOnSelection } from "./hooks/useCopyOnSelection"
import { useProviderMetadata } from "./hooks/useProviderMetadata"
import type { CompletionState } from "../models/ui"
import { resolveUserMessage } from "./lib/input-completion/at-files"
import type { CapabilityCatalog, CapabilitySelection, SubagentType } from "../models/agent"
import type { ModelMetadata, ModelSelection } from "../models/ai-model"
import { ConfigDialog } from "./components/session/ConfigDialog"

type AppProps = {
  initialMessage?: string | null
  /** Loaded from fl0w-work before the first render. */
  initialSession: StoredSession
  initialWorkflows: WorkflowRecord[]
  capabilityCatalog: CapabilityCatalog
  models: ModelMetadata[]
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export function App({ initialMessage, initialSession, initialWorkflows, capabilityCatalog, models }: AppProps) {
  const {
    messages,
    setMessages,
    clearSession,
    getSessions,
    loadSession,
    resumeSession,
    deleteStoredSession,
    applySessionCapabilities,
    applySessionModels,
    session,
  } = useSessionPersistence(initialSession)
  const [listedSessions, setListedSessions] = useState<SessionListEntry[]>([])
  // fl0w-work errors that aren't part of the conversation, shown under initialMessage
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState<"ready" | "working" | "error">("ready")
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [activePhase, setActivePhase] = useState<SubagentType | null>(null)
  const [completion, setCompletion] = useState<CompletionState>({ open: false })
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [generateSessionPickerOpen, setGenerateSessionPickerOpen] = useState(false)
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false)
  const [pendingWorkflow, setPendingWorkflow] = useState<WorkflowRecord | null>(null)
  const [generating, setGenerating] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>(initialWorkflows)
  const [capabilityPickerOpen, setConfigPickerOpen] = useState(
    () => (!isCatalogEmpty(capabilityCatalog) || models.length > 0) && session.capabilities === null,
  )
  const runAbortRef = useRef<AbortController | null>(null)
  const renderer = useRenderer()
  const copiedVisible = useCopyOnSelection()

  useEffect(() => {
    if (isCatalogEmpty(capabilityCatalog)) return

    let cancelled = false

    if (session.capabilities) {
      void applySessionCapabilities(session.capabilities).then(() => {
        if (!cancelled) setConfigPickerOpen(false)
      })
    } else {
      setConfigPickerOpen(true)
    }

    return () => {
      cancelled = true
    }
    // Only re-sync when switching sessions; /configure opens the picker without changing session id.
  }, [applySessionCapabilities, capabilityCatalog, session.id])
  const { width, height } = useTerminalDimensions()
  const { contextPercent, sessionCostUsd, lastInputTokens } = useProviderMetadata(session.id)
  const pendingAsk = findPendingAskQuestion(messages)

  const visibleMessages = useMemo(
    () => messages.filter(({ message }) => message.role !== "system"),
    [messages],
  )

  const toolCallInputs = useMemo(
    () => buildToolCallInputMap(visibleMessages),
    [visibleMessages],
  )

  // Compaction can drop the create_plan call, so keep showing the session's latest plan once it has appeared.
  const lastPlanRef = useRef<{ sessionId: string; plan: PlanProgress } | null>(null)
  const planProgress = useMemo(() => {
    const latest = buildPlanProgress(visibleMessages)
    if (latest) lastPlanRef.current = { sessionId: session.id, plan: latest }
    const kept = lastPlanRef.current
    return latest ?? (kept?.sessionId === session.id ? kept.plan : undefined)
  }, [visibleMessages, session.id])

  const showPlanSidebar = planProgress !== undefined && width >= PLAN_SIDEBAR_MIN_TERMINAL_WIDTH

  const refreshWorkflows = useCallback(async () => {
    try {
      setWorkflows(await listWorkflows())
    } catch (error) {
      setNotice(`Could not load workflows from fl0w-work: ${errorText(error)}`)
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      setListedSessions(await getSessions())
    } catch (error) {
      setNotice(`Could not load sessions from fl0w-work: ${errorText(error)}`)
    }
  }, [getSessions])

  const openConfigPicker = useCallback(() => {
    setConfigPickerOpen(!isCatalogEmpty(capabilityCatalog) || models.length > 0)
  }, [capabilityCatalog, models])

  const slashCommandHandlers = useMemo(
    () => ({
      clearSession: () => {
        clearSession()
        openConfigPicker()
      },
      resumeSession: () => {
        void refreshSessions().then(() => setSessionPickerOpen(true))
      },
      configureCapabilities: openConfigPicker,
      generateWorkflow: () => {
        void refreshSessions().then(() => setGenerateSessionPickerOpen(true))
      },
      runWorkflow: () => {
        void refreshWorkflows().then(() => setWorkflowPickerOpen(true))
      },
    }),
    [clearSession, openConfigPicker, refreshSessions, refreshWorkflows],
  )

  const handleConfigConfirm = useCallback(async (selection: { capabilities: CapabilitySelection, models: ModelSelection }) => {
    await applySessionModels(selection.models)
    await applySessionCapabilities(selection.capabilities)
    setConfigPickerOpen(false)
  }, [applySessionCapabilities, applySessionModels])

  const handleSessionSelect = useCallback((sessionId: string) => {
    setSessionPickerOpen(false)
    void resumeSession(sessionId).catch((error) => {
      setNotice(`Could not load the session from fl0w-work: ${errorText(error)}`)
    })
  }, [resumeSession])

  const handleSessionPickerDismiss = useCallback(() => {
    setSessionPickerOpen(false)
  }, [])

  const handleSessionDelete = useCallback((sessionId: string) => {
    setListedSessions((current) => current.filter(({ id }) => id !== sessionId))
    void deleteStoredSession(sessionId)
  }, [deleteStoredSession])

  const handleWorkflowDelete = useCallback((workflowId: string) => {
    deleteWorkflow(workflowId)
    setPendingWorkflow((current) => (current?.id === workflowId ? null : current))
    setWorkflows((current) => current.filter(({ id }) => id !== workflowId))
  }, [])

  const handleGenerateSessionSelect = useCallback(async (sessionId: string) => {
    setGenerateSessionPickerOpen(false)
    setGenerating(true)

    try {
      const source = await loadSession(sessionId)
      if (!source) throw new WorkflowGenerationError("The selected session is no longer on fl0w-work")
      const generated = await generateWorkflowFromSession(source, resolveModels(session.models).EXECUTE, await listAllTools())
      const saved = saveWorkflow({ sourceSessionId: sessionId, ...generated })
      setWorkflows((current) => [saved, ...current])
      const content = `Workflow saved: ${saved.title}`
      setMessages((previous) => [
        ...previous,
        fl0wMessage({
          role: "assistant",
          content,
        }),
      ])
    } catch (error) {
      const message = error instanceof WorkflowGenerationError
        ? error.message
        : "Could not generate workflow from the selected session"
      setMessages((previous) => [
        ...previous,
        fl0wMessage({ role: "assistant", content: message }),
      ])
    } finally {
      setGenerating(false)
    }
  }, [loadSession, session.models, setMessages])

  const handleGenerateSessionPickerDismiss = useCallback(() => {
    setGenerateSessionPickerOpen(false)
  }, [])

  const handleWorkflowSelect = useCallback((workflowId: string) => {
    const workflow = workflows.find(({ id }) => id === workflowId)
    setWorkflowPickerOpen(false)
    if (workflow) setPendingWorkflow(workflow)
  }, [workflows])

  const handleWorkflowPickerDismiss = useCallback(() => {
    setWorkflowPickerOpen(false)
  }, [])

  const handleCompletionChange = useCallback((next: CompletionState) => {
    setCompletion(next)
  }, [])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (status === "working" || generating) {
        runAbortRef.current?.abort()
      } else {
        flushPendingSkillMirrorsInBackground()
        // anything still unsent stays in the outbox for the next run
        void flushOutbox()
        renderer.destroy()
      }
      return
    }
    if (key.name !== "escape" || !pendingWorkflow) return
    setPendingWorkflow(null)
  })

  const handleSubmit = async (text: string) => {
    if (status === "working" || generating) return

    if (pendingWorkflow) {
      const workflow = pendingWorkflow
      setPendingWorkflow(null)
      setStatus("working")

      const merged = mergeCapabilitySelection(
        getCapabilitySelection(),
        workflow.requiredCapabilities,
      )
      await applySessionCapabilities(merged)
      // after the capabilities are applied, so their front-loaded messages don't capture the workflow; llmLoop clears it
      setActiveWorkflow(workflow, text)

      const userMessage = buildWorkflowUserMessage(workflow, text)
      const nextMessages = [
        ...messages,
        fl0wMessage(userMessage),
        ...buildWorkflowPlanMessages(workflow).map((message) => fl0wMessage(message)),
      ]
      setMessages(nextMessages)

      const runAbort = new AbortController()
      runAbortRef.current = runAbort
      try {
        await llmLoop(nextMessages, session.models, setMessages, runAbort.signal, setStreamingText, setActivePhase);
        setStreamingText(null);
        setStatus("ready");
      } finally {
        runAbortRef.current = null
      }
      return
    }

    if (!text) return

    setStatus("working")
    const userMessage = await resolveUserMessage(text)
    const nextMessages = [...messages, fl0wMessage(userMessage)]
    setMessages(nextMessages)

    const runAbort = new AbortController()
    runAbortRef.current = runAbort
    try {
      await llmLoop(nextMessages, session.models, setMessages, runAbort.signal, setStreamingText, setActivePhase)
      setStreamingText(null);
      setStatus("ready");
    } finally {
      runAbortRef.current = null
    }
  }

  const handleAskQuestionSubmit = async (answersText: string) => {
    if (!pendingAsk || status === "working") return

    setStatus("working")
    const toolResult = fl0wMessage({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: pendingAsk.toolCallId,
        toolName: pendingAsk.toolName,
        output: { type: "text", value: answersText },
      }],
    })
    const nextMessages = [...messages, toolResult]
    setMessages(nextMessages)

    const runAbort = new AbortController()
    runAbortRef.current = runAbort
    try {
      await llmLoop(nextMessages, session.models, setMessages, runAbort.signal, setStreamingText, setActivePhase)
      setStreamingText(null);
      setStatus("ready");
    } finally {
      runAbortRef.current = null
    }
  }

  const inputDisabled = status === "working" || capabilityPickerOpen || generating || sessionPickerOpen || workflowPickerOpen;
  const chatPlaceholder = pendingWorkflow
    ? `Add instructions for "${pendingWorkflow.title}"…`
    : "What would you like to do"

  return (
    <box flexDirection="column" height={height} width="100%" padding={1} position="relative">
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} width="100%">
        <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} height="100%">
          <box flexGrow={1} flexShrink={1} minHeight={0} width="100%" position="relative">
            <scrollbox
              flexGrow={1}
              flexShrink={1}
              minHeight={0}
              width="100%"
              stickyScroll={true}
              stickyStart="bottom"
            >
              {initialMessage && <text fg={"red"}>{initialMessage}</text>}
              {notice && <text fg={"red"}>{notice}</text>}
              <Transcript
                messages={visibleMessages}
                toolCallInputs={toolCallInputs}
                planProgress={planProgress}
                activePhase={status === "working" ? activePhase : null}
                streamingText={streamingText}
              />
            </scrollbox>
            {width >= 64 && (
              <box position="absolute" right={1} bottom={0} zIndex={1}>
                <Mascot working={status === "working" || generating} />
              </box>
            )}
          </box>
          <box flexDirection="column" flexShrink={0} width="100%" paddingTop={1}>
            <box flexDirection="row" width="100%" justifyContent="space-between" alignItems="center">
              {(status === "working" || generating) ? (
                <WorkingIndicator
                  label={
                    generating
                      ? "Generating workflow…"
                      : "Generating next step… (Ctrl+C to stop)"
                  }
                />
              ) : copiedVisible ? (
                <text fg="#9ece6a">Copied</text>
              ) : (
                <box flexShrink={0} />
              )}
              <ContextCostStatusBar
                contextPercent={contextPercent}
                inputTokens={lastInputTokens}
                sessionCostUsd={sessionCostUsd}
                terminalWidth={width}
              />
            </box>
            {status === "error" && <text fg="#f7768e">Run failed — see the assistant message above.</text>}
            {pendingWorkflow && (
              <text fg="#565f89">
                {`Running workflow: ${pendingWorkflow.title} (Esc to cancel)`}
              </text>
            )}
            {pendingAsk ? (
              <ClarifyQuestionBox
                input={pendingAsk.input}
                onSubmit={handleAskQuestionSubmit}
              />
            ) : (
              <ChatInput
                disabled={inputDisabled}
                placeholder={chatPlaceholder}
                allowEmptySubmit={pendingWorkflow !== null}
                slashCommandHandlers={slashCommandHandlers}
                onCompletionChange={handleCompletionChange}
                onSubmit={handleSubmit}
              />
            )}
          </box>
        </box>
        {showPlanSidebar && planProgress && <PlanSidebar progress={planProgress} />}
      </box>
      {completion.open && (
        <CompletionOverlayDialog
          kind={completion.trigger.kind}
          items={completion.items}
          selectedIndex={completion.selectedIndex}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {sessionPickerOpen && (
        <SessionSelectionDialog
          sessions={listedSessions}
          currentSessionId={session.id}
          onSelect={handleSessionSelect}
          onDelete={handleSessionDelete}
          onDismiss={handleSessionPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {generateSessionPickerOpen && (
        <SessionSelectionDialog
          sessions={listedSessions}
          title="Generate workflow from session"
          instructions="↑/↓ to navigate · Enter to generate · x to delete · Esc to dismiss"
          onSelect={handleGenerateSessionSelect}
          onDelete={handleSessionDelete}
          onDismiss={handleGenerateSessionPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {workflowPickerOpen && (
        <WorkflowSelectionDialog
          workflows={workflows}
          onSelect={handleWorkflowSelect}
          onDelete={handleWorkflowDelete}
          onDismiss={handleWorkflowPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {capabilityPickerOpen && (
        <ConfigDialog
          models={models}
          catalog={capabilityCatalog}
          initialSelection={getCapabilitySelection() ?? emptyCapabilitySelection()}
          initialModels={session.models ?? null}
          onConfirm={handleConfigConfirm}
          onDismiss={() => setConfigPickerOpen(false)}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
    </box>
  )
}
