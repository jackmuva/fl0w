import { MouseButton, type MouseEvent } from "@opentui/core"
import { useMemo, useState, type ReactNode } from "react"
import type { Fl0wMessage } from "../../../models/agent"
import { describeToolCall } from "../../lib/format/journal"
import { firstLine, formatMessageContent, truncateLine } from "../../lib/format/message"
import { groupEntries, truncateMiddle, type PhaseSubagent, type TranscriptEntry } from "../../lib/format/segments"
import { EntryView, JournalEntry } from "./JournalEntry"
import { selectionColors, textOnBg, theme } from "../../theme"

const MUTED_FG = theme.muted
const PROSE_PREVIEW_MAX_LENGTH = 96

const PHASE_ACCENT: Record<PhaseSubagent, string> = {
  PLAN: theme.graphite,
  EXECUTE: theme.moss,
}

type PhaseFrameProps = {
  subagent: PhaseSubagent
  messages: Fl0wMessage[]
  live: boolean
  // The final phase of its agent turn; it shows expanded unless the user has toggled it.
  latest: boolean
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
}

const countSteps = (messages: Fl0wMessage[]): number =>
  messages.reduce((count, { message }) => message.role === "assistant" && Array.isArray(message.content)
    ? count + message.content.filter((part) => part.type === "tool-call").length
    : count, 0)

const CHAPTER_TITLE: Record<PhaseSubagent, string> = {
  PLAN: "Plan",
  EXECUTE: "Execute",
}

// A centered chapter heading between thin rules, like a section break in a book; clicking it folds the phase.
const ChapterHeading = ({ children, onToggle }: { children: (fgOnHover: (fg: string) => string) => ReactNode; onToggle?: () => void }) => {
  const [hovered, setHovered] = useState(false)
  const hovering = hovered && Boolean(onToggle)
  // Text on the hover wash goes white when that wash is dark, like the textarea's selection.
  const fgOnHover = (fg: string) => (hovering ? textOnBg(theme.hover, fg) : fg)
  const handleMouseDown = (event: MouseEvent) => {
    if (!onToggle || event.button !== MouseButton.LEFT) return
    event.preventDefault()
    onToggle()
  }
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      flexShrink={0}
      marginBottom={1}
      backgroundColor={hovering ? theme.hover : "transparent"}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={handleMouseDown}
    >
      <box flexGrow={1} height={1} border={["top"]} borderColor={theme.edge} />
      <text fg={fgOnHover(theme.ink)} selectable={false} flexShrink={0} wrapMode="none">{children(fgOnHover)}</text>
      <box flexGrow={1} height={1} border={["top"]} borderColor={theme.edge} />
    </box>
  )
}

const MutedLine = ({ text }: { text: string }) => (
  <box paddingLeft={2}>
    <text {...selectionColors} fg={MUTED_FG}>{text}</text>
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

export const PhaseFrame = ({ subagent, messages, live, latest, toolCallInputs }: PhaseFrameProps) => {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const expanded = expandedOverride ?? latest
  const entries = useMemo(() => groupEntries(messages), [messages])
  const accent = PHASE_ACCENT[subagent]
  const title = CHAPTER_TITLE[subagent]

  const renderFull = () => entries.map((entry, index) => (
    <EntryView key={index} entry={entry} toolCallInputs={toolCallInputs} />
  ))

  if (live) {
    return (
      <box flexDirection="column" flexShrink={0} width="100%">
        <ChapterHeading>
          {(fgOnHover) => <span fg={fgOnHover(accent)}>{` ● ${title}… `}</span>}
        </ChapterHeading>
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
      <ChapterHeading onToggle={() => setExpandedOverride(!expanded)}>
        {(fgOnHover) => (
          <>
            <span fg={fgOnHover(MUTED_FG)}>{expanded ? " ▾ " : " ▸ "}</span>
            <span fg={fgOnHover(accent)}>{title}</span>
            <span fg={fgOnHover(MUTED_FG)}>{` · ${steps} ${steps === 1 ? "step" : "steps"} `}</span>
          </>
        )}
      </ChapterHeading>
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
