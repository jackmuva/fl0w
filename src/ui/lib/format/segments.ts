import type { ModelMessage } from "ai"
import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import { isStandaloneTool } from "./journal"
import { formatMessageContent, formatReasoningContent } from "./message"

export type PhaseSubagent = Exclude<SubagentType, "ROUTER">

const PHASE_SUBAGENTS = new Set<SubagentType>(["DISCOVERY", "PLAN", "EXECUTE"])

export const isPhaseSubagent = (subagent: SubagentType | undefined | null): subagent is PhaseSubagent =>
  subagent !== undefined && subagent !== null && PHASE_SUBAGENTS.has(subagent)

export type TranscriptEntry =
  | { kind: "single"; message: Fl0wMessage; index: number; hideToolCalls?: true }
  | { kind: "burst"; messages: Fl0wMessage[]; startIndex: number }

export type TranscriptSegment =
  | { kind: "phase"; subagent: PhaseSubagent; messages: Fl0wMessage[]; startIndex: number }
  | TranscriptEntry

// Tool calls and results that render as a journal sentence rather than their own view.
const joinsBurst = (message: ModelMessage): boolean => {
  if (!Array.isArray(message.content)) return false
  if (message.role === "assistant") {
    const calls = message.content.filter((part) => part.type === "tool-call")
    return calls.length > 0 && calls.every((part) => !isStandaloneTool(part.toolName))
  }
  if (message.role === "tool") {
    return message.content.length > 0
      && message.content.every((part) => part.type === "tool-result" && !isStandaloneTool(part.toolName))
  }
  return false
}

const hasProse = (message: ModelMessage): boolean =>
  message.role === "assistant"
  && Boolean(formatMessageContent(message).trim() || formatReasoningContent(message).trim())

// Collects consecutive tool calls and results into bursts. An assistant message that mixes prose
// with tool calls is split: its prose stays a single entry and its calls start the next burst.
export const groupEntries = (messages: Fl0wMessage[], startIndex = 0): TranscriptEntry[] => {
  const entries: TranscriptEntry[] = []

  messages.forEach((entry, offset) => {
    const index = startIndex + offset
    if (!joinsBurst(entry.message)) {
      entries.push({ kind: "single", message: entry, index })
      return
    }

    if (hasProse(entry.message)) entries.push({ kind: "single", message: entry, index, hideToolCalls: true })
    const last = entries[entries.length - 1]
    if (last?.kind === "burst") last.messages.push(entry)
    else entries.push({ kind: "burst", messages: [entry], startIndex: index })
  })

  return entries
}

export const groupTranscript = (messages: Fl0wMessage[]): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = []
  let loose: Fl0wMessage[] = []
  let looseStart = 0

  const flushLoose = () => {
    segments.push(...groupEntries(loose, looseStart))
    loose = []
  }

  messages.forEach((entry, index) => {
    const { subagent } = entry
    if (!isPhaseSubagent(subagent)) {
      if (loose.length === 0) looseStart = index
      loose.push(entry)
      return
    }

    flushLoose()
    const last = segments[segments.length - 1]
    if (last?.kind === "phase" && last.subagent === subagent) {
      last.messages.push(entry)
    } else {
      segments.push({ kind: "phase", subagent, messages: [entry], startIndex: index })
    }
  })
  flushLoose()

  return segments
}

export type TruncatedList<T> = {
  head: T[]
  hiddenCount: number
  tail: T[]
}

export const truncateMiddle = <T>(rows: T[], head = 3, tail = 3): TruncatedList<T> => {
  if (rows.length <= head + tail) return { head: rows, hiddenCount: 0, tail: [] }
  return {
    head: rows.slice(0, head),
    hiddenCount: rows.length - head - tail,
    tail: rows.slice(rows.length - tail),
  }
}
