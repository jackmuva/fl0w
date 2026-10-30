import { useMemo, useState, type ReactNode } from "react"
import type { Fl0wMessage } from "../../../models/agent"
import { describeToolCall } from "../../lib/format/journal"
import { firstLine, formatMessageContent, truncateLine } from "../../lib/format/message"
import { groupEntries, truncateMiddle, type PhaseSubagent, type TranscriptEntry } from "../../lib/format/segments"
import { ExpandableRow } from "../primitives/ExpandableRow"
import { EntryView, JournalEntry } from "./JournalEntry"

const MUTED_FG = "#565f89"
const PROSE_PREVIEW_MAX_LENGTH = 96

const PHASE_ACCENT: Record<PhaseSubagent, string> = {
  DISCOVERY: "#7aa2f7",
  PLAN: "#bb9af7",
  EXECUTE: "#7dcfff",
}

type PhaseFrameProps = {
  subagent: PhaseSubagent
  messages: Fl0wMessage[]
  live: boolean
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
}

const countSteps = (messages: Fl0wMessage[]): number =>
  messages.reduce((count, { message }) => message.role === "assistant" && Array.isArray(message.content)
    ? count + message.content.filter((part) => part.type === "tool-call").length
    : count, 0)

const MutedLine = ({ text }: { text: string }) => (
  <box paddingLeft={2}>
    <text fg={MUTED_FG}>{text}</text>
  </box>
)

// The one-line form of an entry in a collapsed phase, or null when it has nothing to say.
const compactEntry = (entry: TranscriptEntry): ReactNode => {
  if (entry.kind === "burst") return <JournalEntry messages={entry.messages} />

  const { message } = entry.message
  if (message.role !== "assistant") return null
  const prose = firstLine(formatMessageContent(message))
  if (prose) return <MutedLine text={truncateLine(prose, PROSE_PREVIEW_MAX_LENGTH)} />
  if (!Array.isArray(message.content)) return null

  const labels = message.content.flatMap((part) => part.type === "tool-call" && !entry.hideToolCalls
    ? [describeToolCall(part.toolName, part.input)]
    : [])
  return labels.length ? <MutedLine text={`~ ${labels.join(", ")}`} /> : null
}

// A running phase streams in full; once finished it collapses to the first and last of its entries.
export const PhaseFrame = ({ subagent, messages, live, toolCallInputs }: PhaseFrameProps) => {
  const [expanded, setExpanded] = useState(false)
  const entries = useMemo(() => groupEntries(messages), [messages])
  const accent = PHASE_ACCENT[subagent]
  const name = subagent.toLowerCase()

  const renderFull = () => entries.map((entry, index) => (
    <EntryView key={index} entry={entry} toolCallInputs={toolCallInputs} />
  ))

  if (live) {
    return (
      <box flexDirection="column" flexShrink={0} width="100%">
        <text fg={accent} selectable={false} marginBottom={1}>{`● ${name}…`}</text>
        {renderFull()}
      </box>
    )
  }

  const compact = entries
    .map((entry, index) => ({ index, node: compactEntry(entry) }))
    .filter((row) => row.node !== null)
  if (compact.length === 0) return null

  const steps = countSteps(messages)
  const { head, hiddenCount, tail } = truncateMiddle(compact, 2, 2)

  return (
    <box flexDirection="column" flexShrink={0} width="100%" marginBottom={1}>
      <box marginBottom={1}>
        <ExpandableRow expanded={expanded} onToggle={() => setExpanded((value) => !value)} chevronFg={accent}>
          <text selectable={false}>
            <span fg={accent}>{name}</span>
            <span fg={MUTED_FG}>{` · ${steps} ${steps === 1 ? "step" : "steps"}`}</span>
          </text>
        </ExpandableRow>
      </box>
      {expanded ? renderFull() : (
        <>
          {head.map((row) => <box key={row.index} width="100%">{row.node}</box>)}
          {hiddenCount > 0 && <MutedLine text={`⋯ ${hiddenCount} more`} />}
          {tail.map((row) => <box key={row.index} width="100%">{row.node}</box>)}
        </>
      )}
    </box>
  )
}
