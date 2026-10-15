import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fl0wLoop, type fl0wLoopResult } from "../services/agent/agent-loop"
import {
  getCapabilitySelection,
  emptyCapabilitySelection,
  isCatalogEmpty,
  mergeCapabilitySelection,
} from "../services/agent/capabilities"
import { findPendingAskQuestion } from "../services/agent/utils/ask-question-state"
import { fl0wMessage, parseDecisionMessage } from "../services/agent/utils/fl0w-message"
import { buildWorkflowUserMessage } from "../services/workflow/build-message"
import { generateWorkflowFromSession, WorkflowGenerationError } from "../services/workflow/generate"
import { WorkflowStore } from "../db/workflow-store"
import { pushWorkflowsInBackground } from "../services/sync/workflow-sync"
import { flushPendingSkillMirrorsInBackground } from "../services/skills/mirror-enabled-skills"
import type { WorkflowRecord } from "../models/workflow"
import { useSessionPersistence } from "./hooks/useSessionPersistence"
import { buildToolCallInputMap } from "./lib/format/message"
import { CompletionOverlayDialog } from "./components/input/CompletionOverlayDialog"
import { CapabilitySelectionDialog } from "./components/session/CapabilitySelectionDialog"
import { SessionSelectionDialog } from "./components/session/SessionSelectionDialog"
import { WorkflowSelectionDialog } from "./components/workflow/WorkflowSelectionDialog"
import { ChatInput } from "./components/input/ChatInput"
import { ClarifyQuestionBox } from "./components/primitives/ClarifyQuestionBox"
import { MessageContent } from "./components/primitives/MessageContent"
import { ContextCostStatusBar } from "./components/primitives/ContextCostStatusBar"
import { WorkingIndicator } from "./components/primitives/WorkingIndicator"
import { useCopyOnSelection } from "./hooks/useCopyOnSelection"
import { useProviderMetadata } from "./hooks/useProviderMetadata"
import type { CompletionState } from "../models/ui"
import { resolveUserMessage } from "./lib/input-completion/at-files"
import type { CapabilityCatalog, CapabilitySelection, Fl0wMessage } from "../models/agent"

type AppProps = {
  initialMessage?: string | null
  seedMessages: Fl0wMessage[]
  capabilityCatalog: CapabilityCatalog
}

export function App({ initialMessage, seedMessages, capabilityCatalog }: AppProps) {
  const {
    messages,
    setMessages,
    clearSession,
    getSessions,
    loadSessionMessages,
    getSessionCapabilities,
    resumeSession,
    applySessionCapabilities,
    session,
  } = useSessionPersistence(seedMessages)
  const workflowStore = useMemo(() => WorkflowStore.open(), [])
  const [status, setStatus] = useState<"ready" | "working" | "error">("ready")
  const [completion, setCompletion] = useState<CompletionState>({ open: false })
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [generateSessionPickerOpen, setGenerateSessionPickerOpen] = useState(false)
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false)
  const [pendingWorkflow, setPendingWorkflow] = useState<WorkflowRecord | null>(null)
  const [generating, setGenerating] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>(() =>
    workflowStore.listWorkflows(),
  )
  const [capabilityPickerOpen, setCapabilityPickerOpen] = useState(
    () => !isCatalogEmpty(capabilityCatalog) && session.capabilities === null,
  )
  const runAbortRef = useRef<AbortController | null>(null)
  const renderer = useRenderer()
  const copiedVisible = useCopyOnSelection()

  useEffect(() => {
    if (isCatalogEmpty(capabilityCatalog)) return

    if (session.capabilities) {
      void applySessionCapabilities(session.capabilities).then(() => {
        setCapabilityPickerOpen(false)
      })
    } else {
      setCapabilityPickerOpen(true)
    }
  }, [applySessionCapabilities, capabilityCatalog, session.id])
  const { width, height } = useTerminalDimensions()
  const { contextPercent, sessionCostUsd, sessionTokensUsed } = useProviderMetadata(session.id)
  const pendingAsk = findPendingAskQuestion(messages)

  const visibleMessages = useMemo(
    () => messages.filter(({ message }) => message.role !== "system"),
    [messages],
  )

  const toolCallInputs = useMemo(
    () => buildToolCallInputMap(visibleMessages),
    [visibleMessages],
  )

  const refreshWorkflows = useCallback(() => {
    setWorkflows(workflowStore.listWorkflows())
  }, [workflowStore])

  const openCapabilityPicker = useCallback(() => {
    setCapabilityPickerOpen(!isCatalogEmpty(capabilityCatalog))
  }, [capabilityCatalog])

  const slashCommandHandlers = useMemo(
    () => ({
      clearSession: () => {
        clearSession()
        openCapabilityPicker()
      },
      resumeSession: () => setSessionPickerOpen(true),
      configureCapabilities: openCapabilityPicker,
      generateWorkflow: () => setGenerateSessionPickerOpen(true),
      runWorkflow: () => {
        refreshWorkflows()
        setWorkflowPickerOpen(true)
      },
    }),
    [clearSession, openCapabilityPicker, refreshWorkflows],
  )

  const handleCapabilityConfirm = useCallback(async (selection: CapabilitySelection) => {
    await applySessionCapabilities(selection)
    setCapabilityPickerOpen(false)
  }, [applySessionCapabilities])

  const handleSessionSelect = useCallback((sessionId: string) => {
    resumeSession(sessionId)
    setSessionPickerOpen(false)
  }, [resumeSession])

  const handleSessionPickerDismiss = useCallback(() => {
    setSessionPickerOpen(false)
  }, [])

  const handleGenerateSessionSelect = useCallback(async (sessionId: string) => {
    setGenerateSessionPickerOpen(false)
    setGenerating(true)

    try {
      const sessionMessages = loadSessionMessages(sessionId)
      const generated = await generateWorkflowFromSession(sessionMessages)
      const requiredCapabilities = getSessionCapabilities(sessionId) ?? emptyCapabilitySelection()
      const saved = workflowStore.saveWorkflow({
        sourceSessionId: sessionId,
        title: generated.title,
        goal: generated.goal,
        steps: generated.steps,
        requiredCapabilities,
      })
      refreshWorkflows()
      pushWorkflowsInBackground(workflowStore)
      setMessages((previous) => [
        ...previous,
        fl0wMessage({
          role: "assistant",
          content: `Workflow saved: ${saved.title}`,
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
  }, [getSessionCapabilities, loadSessionMessages, refreshWorkflows, setMessages, workflowStore])

  const handleGenerateSessionPickerDismiss = useCallback(() => {
    setGenerateSessionPickerOpen(false)
  }, [])

  const handleWorkflowSelect = useCallback((workflowId: string) => {
    const workflow = workflowStore.getWorkflow(workflowId)
    setWorkflowPickerOpen(false)
    if (workflow) setPendingWorkflow(workflow)
  }, [workflowStore])

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
        renderer.destroy()
      }
      return
    }
    if (key.name !== "escape" || !pendingWorkflow) return
    setPendingWorkflow(null)
  })

  const finishAgentRun = (outcome: fl0wLoopResult) => {
    setStatus(outcome === "error" ? "error" : "ready")
  }

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

      const userMessage = buildWorkflowUserMessage(workflow, text)
      const nextMessages = [...messages, fl0wMessage(userMessage)]
      setMessages(nextMessages)

      const runAbort = new AbortController()
      runAbortRef.current = runAbort
      try {
        finishAgentRun(await fl0wLoop(nextMessages, setMessages, runAbort.signal))
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
      finishAgentRun(await fl0wLoop(nextMessages, setMessages, runAbort.signal))
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
        toolName: "AskQuestion",
        output: { type: "text", value: answersText },
      }],
    })
    const nextMessages = [...messages, toolResult]
    setMessages(nextMessages)

    const runAbort = new AbortController()
    runAbortRef.current = runAbort
    try {
      finishAgentRun(await fl0wLoop(nextMessages, setMessages, runAbort.signal))
    } finally {
      runAbortRef.current = null
    }
  }

  const inputDisabled = status === "working" || capabilityPickerOpen || generating
  const chatPlaceholder = pendingWorkflow
    ? `Add instructions for "${pendingWorkflow.title}"…`
    : "What would you like to do"

  return (
    <box flexDirection="column" height={height} width="100%" padding={1} position="relative">
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        width="100%"
        stickyScroll={true}
        stickyStart="bottom"
      >
        {initialMessage && <text fg={"red"}>{initialMessage}</text>}
        {visibleMessages.map((message, index) => (
          <MessageContent
            key={index}
            message={message}
            toolCallInputs={toolCallInputs}
            decision={index > 0 ? parseDecisionMessage(visibleMessages[index - 1]!) : null}
          />
        ))}
      </scrollbox>
      <box flexDirection="column" flexShrink={0} width="100%" paddingTop={1}>
        <box flexDirection="row" width="100%" justifyContent="space-between" alignItems="center">
          {(status === "working" || generating) ? (
            <WorkingIndicator
              label={
                generating
                  ? "Generating workflow…"
                  : "Working… (Ctrl+C to stop)"
              }
            />
          ) : copiedVisible ? (
            <text fg="#9ece6a">Copied</text>
          ) : (
            <box flexShrink={0} />
          )}
          <ContextCostStatusBar
            contextPercent={contextPercent}
            sessionTokensUsed={sessionTokensUsed}
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
          sessions={getSessions()}
          currentSessionId={session.id}
          onSelect={handleSessionSelect}
          onDismiss={handleSessionPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {generateSessionPickerOpen && (
        <SessionSelectionDialog
          sessions={getSessions()}
          title="Generate workflow from session"
          instructions="↑/↓ to navigate · Enter to generate · Esc to dismiss"
          onSelect={handleGenerateSessionSelect}
          onDismiss={handleGenerateSessionPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {workflowPickerOpen && (
        <WorkflowSelectionDialog
          workflows={workflows}
          onSelect={handleWorkflowSelect}
          onDismiss={handleWorkflowPickerDismiss}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
      {capabilityPickerOpen && (
        <CapabilitySelectionDialog
          catalog={capabilityCatalog}
          initialSelection={getCapabilitySelection() ?? emptyCapabilitySelection()}
          onConfirm={handleCapabilityConfirm}
          onDismiss={() => setCapabilityPickerOpen(false)}
          terminalWidth={width}
          terminalHeight={height}
        />
      )}
    </box>
  )
}
