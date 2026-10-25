import { MouseButton, RGBA, type MouseEvent } from "@opentui/core"
import { useMemo, useState } from "react"
import type { Fl0wMessage } from "../../../models/agent"
import {
  buildPhaseDigest,
  truncateDigest,
  type DigestRow,
  type DigestStatus,
  type PhaseSubagent,
} from "../../lib/format/segments"
import { MessageContent } from "../primitives/MessageContent"
import { GREEN_FG } from "../primitives/MessageFrame"
import { WorkflowEdge } from "../primitives/WorkflowEdge"

const MUTED_FG = "#565f89"
const ERROR_FG = "#f7768e"
const TERMINAL_BG = RGBA.defaultBackground()

const PHASE_ACCENT: Record<PhaseSubagent, string> = {
  DISCOVERY: "#7aa2f7",
  PLAN: "#bb9af7",
  EXECUTE: "#7dcfff",
}

const DIGEST_GLYPH: Record<DigestStatus, string> = {
  ok: "✓",
  error: "✗",
  pending: "…",
  text: "›",
}

const DIGEST_FG: Record<DigestStatus, string> = {
  ok: GREEN_FG,
  error: ERROR_FG,
  pending: MUTED_FG,
  text: MUTED_FG,
}

type PhaseFrameProps = {
  subagent: PhaseSubagent
  messages: Fl0wMessage[]
  live: boolean
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
}

const DigestLine = ({ row }: { row: DigestRow }) => (
  <text>
    <span fg={DIGEST_FG[row.status]}>{DIGEST_GLYPH[row.status]}</span> {row.label}
  </text>
)

const PhaseMessages = ({ messages, toolCallInputs }: Pick<PhaseFrameProps, "messages" | "toolCallInputs">) => (
  <>
    {messages.map((message, index) => (
      <MessageContent key={index} message={message} toolCallInputs={toolCallInputs} />
    ))}
  </>
)

// A running phase streams in full; once finished it collapses to the head and tail of its digest.
export const PhaseFrame = ({ subagent, messages, live, toolCallInputs }: PhaseFrameProps) => {
  const [expanded, setExpanded] = useState(false)
  const rows = useMemo(() => buildPhaseDigest(messages), [messages])
  const accent = PHASE_ACCENT[subagent]

  if (live) {
    return (
      <box flexDirection="column" flexShrink={0} width="100%">
        <text fg={accent} selectable={false}>{`● ${subagent} · running`}</text>
        <PhaseMessages messages={messages} toolCallInputs={toolCallInputs} />
      </box>
    )
  }

  if (rows.length === 0) return null

  const handleToggle = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT) return
    event.preventDefault()
    setExpanded((value) => !value)
  }

  const { head, hiddenCount, tail } = truncateDigest(rows)
  const stepLabel = `${rows.length} ${rows.length === 1 ? "step" : "steps"}`

  return (
    <box flexDirection="column" flexShrink={0} width="100%" marginBottom={1}>
      <WorkflowEdge />
      <box
        border={true}
        borderStyle="rounded"
        borderColor={accent}
        title={` ◆ ${subagent} · ${stepLabel} `}
        titleColor={accent}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        width="100%"
        backgroundColor={TERMINAL_BG}
      >
        {expanded ? (
          <PhaseMessages messages={messages} toolCallInputs={toolCallInputs} />
        ) : (
          <>
            {head.map((row, index) => <DigestLine key={`h${index}`} row={row} />)}
            {hiddenCount > 0 && <text fg={MUTED_FG}>{`⋯ ${hiddenCount} more`}</text>}
            {tail.map((row, index) => <DigestLine key={`t${index}`} row={row} />)}
          </>
        )}
        <text fg={MUTED_FG} selectable={false} onMouseDown={handleToggle}>
          {expanded ? "▴ collapse" : "▾ expand"}
        </text>
      </box>
    </box>
  )
}
