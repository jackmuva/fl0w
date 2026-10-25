import type { ModelMessage } from "ai"
import type { Fl0wMessage } from "../../../models/agent"

const EXT_TO_FILETYPE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  toml: "toml",
  xml: "xml",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  vue: "vue",
  svelte: "svelte",
}

export const filetypeFromPath = (filePath?: string): string | undefined => {
  if (!filePath) return undefined
  const ext = filePath.split(".").pop()?.toLowerCase()
  if (!ext) return undefined
  return EXT_TO_FILETYPE[ext]
}

export type ParsedLineNumberedContent = {
  content: string
  startLine: number
}

export const parseLineNumberedContent = (text: string): ParsedLineNumberedContent => {
  const lines = text.split("\n")
  const parsedLines: string[] = []
  let startLine = 1

  for (const line of lines) {
    const match = line.match(/^(\d+):\s(.*)$/)
    if (!match) {
      parsedLines.push(line)
      continue
    }

    const lineNumber = Number(match[1])
    if (parsedLines.length === 0) startLine = lineNumber
    parsedLines.push(match[2] ?? "")
  }

  return {
    content: parsedLines.join("\n"),
    startLine,
  }
}

export const looksLikeLineNumberedOutput = (text: string): boolean =>
  /^\d+:\s/.test(text.trim())

export const looksLikeMarkdown = (text: string): boolean =>
  /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|```|\[.+\]\(.+\))/.test(text)

export const buildUnifiedDiff = (
  filePath: string,
  oldText: string,
  newText: string,
): string => {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const header = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)} @@`,
  ]

  const body: string[] = []
  for (const line of oldLines) body.push(`-${line}`)
  for (const line of newLines) body.push(`+${line}`)

  return [...header, ...body].join("\n")
}

export const buildWriteDiff = (filePath: string, content: string): string =>
  buildUnifiedDiff(filePath, "", content)

export const asRecord = (input: unknown): Record<string, unknown> | undefined =>
  input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined

export const readStringField = (input: unknown, key: string): string | undefined => {
  const record = asRecord(input)
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

export const readNumberField = (input: unknown, key: string, fallback: number): number => {
  const record = asRecord(input)
  const value = record?.[key]
  return typeof value === "number" ? value : fallback
}

export const callTitle = (toolName: string) => `▶ ${toolName}`

export const parsePlanSteps = (text: string): string[] => {
  const steps: string[] = []

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const numbered = trimmed.match(/^(?:\d+[.)]\s*|\[\s*[xX ]?\s*\]\s*|-|\*|\+)\s*(.+)$/)
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/)
    const step = numbered?.[1] ?? heading?.[1]

    if (step) {
      steps.push(step.trim())
    }
  }

  return steps
}

export const concatenateSubtitle = (items: string[], maxLength = 72): string => {
  if (items.length === 0) return ""

  let subtitle = ""
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const candidate = subtitle ? `${subtitle} · ${item}` : item

    if (candidate.length > maxLength && subtitle) {
      return `${subtitle} · +${items.length - index} more`
    }

    subtitle = candidate
  }

  return subtitle
}

export type ToolResultPart = Extract<
  NonNullable<ModelMessage["content"]>[number],
  { type: "tool-result" }
>

export type ToolCallPart = Extract<
  NonNullable<ModelMessage["content"]>[number],
  { type: "tool-call" }
>

export const formatToolResultText = (part: ToolResultPart): string => {
  if ("value" in part.output) {
    const value = part.output.value
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2)
  }
  return `[${part.output.type}]`
}

export const isToolResultError = (part: ToolResultPart): boolean =>
  part.output.type === "error-text"

export const buildToolCallInputMap = (messages: Fl0wMessage[]): Map<string, { toolName: string; input: unknown }> => {
  const map = new Map<string, { toolName: string; input: unknown }>()

  for (const { message } of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool-call") continue
      map.set(part.toolCallId, { toolName: part.toolName, input: part.input })
    }
  }

  return map
}


export type PlanStepProgress = {
  index: number
  description: string
  done: boolean
}

export type PlanProgress = {
  toolCallId: string
  steps: PlanStepProgress[]
}

const bareToolName = (toolName: string) => toolName.split("/").pop() ?? toolName

export const readPlanSteps = (input: unknown): Omit<PlanStepProgress, "done">[] => {
  const steps = asRecord(input)?.steps
  if (!Array.isArray(steps)) return []
  return steps.flatMap((step) => {
    const index = asRecord(step)?.index
    const description = asRecord(step)?.description
    return typeof index === "number" && typeof description === "string" ? [{ index, description }] : []
  })
}

// Latest create_plan call plus every mark_step_complete call made after it.
export const buildPlanProgress = (messages: Fl0wMessage[]): PlanProgress | undefined => {
  let progress: PlanProgress | undefined
  let completed = new Set<number>()

  for (const { message } of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool-call") continue
      const name = bareToolName(part.toolName)
      if (name === "create_plan") {
        const steps = readPlanSteps(part.input)
        if (steps.length === 0) continue
        progress = { toolCallId: part.toolCallId, steps: steps.map((step) => ({ ...step, done: false })) }
        completed = new Set()
      } else if (name === "mark_step_complete") {
        const index = asRecord(part.input)?.index
        if (typeof index === "number") completed.add(index)
      }
    }
  }

  if (!progress) return undefined
  return {
    ...progress,
    steps: progress.steps.map((step) => ({ ...step, done: completed.has(step.index) })),
  }
}
