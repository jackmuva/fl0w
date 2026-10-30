import { useMemo, useState } from "react"
import type { Fl0wMessage } from "../../../models/agent"
import {
  buildJournalSteps,
  composeSentence,
  describeToolCall,
  type JournalStep,
  type StepStatus,
} from "../../lib/format/journal"
import { bareToolName, firstLine, formatToolResultText, truncateLine } from "../../lib/format/message"
import type { TranscriptEntry } from "../../lib/format/segments"
import { renderToolCall, renderToolResult } from "../../tool-renderers"
import { ExpandableRow } from "../primitives/ExpandableRow"
import { MessageContent } from "../primitives/MessageContent"
import { CREAM_FG, GREEN_FG, MessageFrameKindContext } from "../primitives/MessageFrame"

const JOURNAL_FG = "#a59d8f"
const MUTED_FG = "#565f89"
const ERROR_FG = "#f7768e"
const ERROR_PEEK_FG = "#c0687b"
const ERROR_PEEK_MAX_LENGTH = 96

const STEP_GLYPH: Record<StepStatus, string> = {
  ok: "✓",
  error: "✗",
  pending: "…",
}

const STEP_FG: Record<StepStatus, string> = {
  ok: GREEN_FG,
  error: ERROR_FG,
  pending: MUTED_FG,
}

type ToolCallInputs = Map<string, { toolName: string; input: unknown }>

const StepDetail = ({ step }: { step: JournalStep }) => {
  if (!step.result) {
    return (
      <MessageFrameKindContext.Provider value="call">
        {renderToolCall({ toolName: bareToolName(step.toolName), toolCallId: step.toolCallId, input: step.input, text: "" })}
      </MessageFrameKindContext.Provider>
    )
  }
  return (
    <MessageFrameKindContext.Provider value="output">
      {renderToolResult({
        toolName: bareToolName(step.toolName),
        toolCallId: step.toolCallId,
        input: step.input,
        output: step.result.output,
        text: formatToolResultText(step.result),
        isError: step.status === "error",
      })}
    </MessageFrameKindContext.Provider>
  )
}

const StepRow = ({ step }: { step: JournalStep }) => {
  const [open, setOpen] = useState(false)
  return (
    <box flexDirection="column" width="100%" paddingLeft={2}>
      <ExpandableRow expanded={open} onToggle={() => setOpen((value) => !value)}>
        <text selectable={false}>
          <span fg={STEP_FG[step.status]}>{STEP_GLYPH[step.status]}</span>
          {` ${describeToolCall(step.toolName, step.input)}`}
        </text>
      </ExpandableRow>
      {open && (
        <box width="100%" paddingLeft={2} paddingTop={1}>
          <StepDetail step={step} />
        </box>
      )}
    </box>
  )
}

// One burst of tool calls, told as a single sentence; clicking it unfolds the individual steps.
export const JournalEntry = ({ messages }: { messages: Fl0wMessage[] }) => {
  const [expanded, setExpanded] = useState(false)
  const steps = useMemo(() => buildJournalSteps(messages), [messages])
  const fragments = useMemo(() => composeSentence(steps), [steps])
  if (steps.length === 0) return null

  const failures = steps.filter((step) => step.status === "error" && step.result)

  return (
    <box flexDirection="column" flexShrink={0} width="100%" paddingLeft={2} marginBottom={1}>
      <ExpandableRow expanded={expanded} onToggle={() => setExpanded((value) => !value)}>
        <text fg={JOURNAL_FG} selectable={false}>
          {fragments.map((fragment, index) => fragment.noun
            ? <span key={index} fg={CREAM_FG}>{fragment.text}</span>
            : fragment.text)}
        </text>
      </ExpandableRow>
      {!expanded && failures.map((step) => (
        <box key={step.toolCallId} paddingLeft={2}>
          <text fg={ERROR_PEEK_FG}>
            {`↳ ${truncateLine(firstLine(formatToolResultText(step.result!)), ERROR_PEEK_MAX_LENGTH)}`}
          </text>
        </box>
      ))}
      {expanded && steps.map((step) => <StepRow key={step.toolCallId} step={step} />)}
    </box>
  )
}

type EntryViewProps = {
  entry: TranscriptEntry
  toolCallInputs: ToolCallInputs
}

export const EntryView = ({ entry, toolCallInputs }: EntryViewProps) => entry.kind === "burst"
  ? <JournalEntry messages={entry.messages} />
  : <MessageContent message={entry.message} toolCallInputs={toolCallInputs} hideToolCalls={entry.hideToolCalls} />
