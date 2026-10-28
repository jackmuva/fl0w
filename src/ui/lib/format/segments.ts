import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import {
  bareToolName,
  formatMessageContent,
  isToolResultError,
  readNumberField,
  readPlanSteps,
  readStringField,
  type ToolResultPart,
} from "./message"

export type PhaseSubagent = Extract<SubagentType, "DISCOVERY" | "PLAN" | "EXECUTE">

const PHASE_SUBAGENTS = new Set<SubagentType>(["DISCOVERY", "PLAN", "EXECUTE"])

export const isPhaseSubagent = (subagent: SubagentType | undefined | null): subagent is PhaseSubagent =>
  subagent !== undefined && subagent !== null && PHASE_SUBAGENTS.has(subagent)

export type TranscriptSegment =
  | { kind: "phase"; subagent: PhaseSubagent; messages: Fl0wMessage[]; startIndex: number }
  | { kind: "single"; message: Fl0wMessage; index: number }

export const groupTranscript = (messages: Fl0wMessage[]): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = []

  messages.forEach((entry, index) => {
    const { subagent } = entry
    if (!isPhaseSubagent(subagent)) {
      segments.push({ kind: "single", message: entry, index })
      return
    }

    const last = segments[segments.length - 1]
    if (last?.kind === "phase" && last.subagent === subagent) {
      last.messages.push(entry)
    } else {
      segments.push({ kind: "phase", subagent, messages: [entry], startIndex: index })
    }
  })

  return segments
}

export type DigestStatus = "ok" | "error" | "pending" | "text"

export type DigestRow = {
  status: DigestStatus
  label: string
}

const DIGEST_MAX_LENGTH = 96
const PRIMARY_INPUT_FIELDS = ["command", "path", "file_path", "pattern", "url", "query"]
const SKIPPED_DIGEST_TOOLS = new Set(["ask_question"])

const truncateLine = (text: string, maxLength = DIGEST_MAX_LENGTH) => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim()) ?? ""

const describeToolCall = (toolName: string, input: unknown): string => {
  const name = bareToolName(toolName)
  if (name === "create_plan") {
    const title = readStringField(input, "title")?.trim()
    const count = readPlanSteps(input).length
    return ["plan", title, `${count} steps`].filter(Boolean).join(" · ")
  }
  if (name === "mark_step_complete") {
    return `step ${readNumberField(input, "index", 0) || "?"} complete`
  }

  for (const field of PRIMARY_INPUT_FIELDS) {
    const value = readStringField(input, field)
    if (value?.trim()) return `${name} · ${firstLine(value)}`
  }
  return name
}

// One line per tool call (paired with its result) or assistant text block within a phase.
export const buildPhaseDigest = (messages: Fl0wMessage[]): DigestRow[] => {
  const results = new Map<string, ToolResultPart>()
  for (const { message } of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === "tool-result") results.set(part.toolCallId, part)
    }
  }

  const rows: DigestRow[] = []
  for (const { message } of messages) {
    if (message.role !== "assistant") continue

    const text = firstLine(formatMessageContent(message))
    if (text) rows.push({ status: "text", label: truncateLine(text) })

    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool-call") continue
      if (SKIPPED_DIGEST_TOOLS.has(bareToolName(part.toolName))) continue

      const result = results.get(part.toolCallId)
      const status: DigestStatus = !result ? "pending" : isToolResultError(result) ? "error" : "ok"
      rows.push({ status, label: truncateLine(describeToolCall(part.toolName, part.input)) })
    }
  }

  return rows
}

export type TruncatedDigest = {
  head: DigestRow[]
  hiddenCount: number
  tail: DigestRow[]
}

export const truncateDigest = (rows: DigestRow[], head = 3, tail = 3): TruncatedDigest => {
  if (rows.length <= head + tail) return { head: rows, hiddenCount: 0, tail: [] }
  return {
    head: rows.slice(0, head),
    hiddenCount: rows.length - head - tail,
    tail: rows.slice(rows.length - tail),
  }
}
