import type { Fl0wMessage } from "../../../models/agent"
import {
  bareToolName,
  firstLine,
  isToolResultError,
  readNumberField,
  readPlanSteps,
  readStringField,
  truncateLine,
  type ToolResultPart,
} from "./message"

export type StepStatus = "ok" | "error" | "pending"

export type JournalStep = {
  toolCallId: string
  toolName: string
  input: unknown
  result?: ToolResultPart
  status: StepStatus
}

// A run of text in a journal sentence; `noun` marks file names, commands and queries.
export type SentenceFragment = {
  text: string
  noun?: true
}

const LABEL_MAX_LENGTH = 96
const OBJECT_MAX_LENGTH = 40
const PRIMARY_INPUT_FIELDS = ["command", "filePath", "path", "file_path", "pattern", "url", "query", "name"]

// Tools that keep their own view in the transcript instead of joining a journal sentence.
export const STANDALONE_TOOLS = new Set(["ask_question", "create_plan", "mark_step_complete", "message_answer"])

export const isStandaloneTool = (toolName: string): boolean => STANDALONE_TOOLS.has(bareToolName(toolName))

// One-line label for a tool call, used in step lists.
export const describeToolCall = (toolName: string, input: unknown): string => {
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
    if (value?.trim()) return truncateLine(`${name} · ${firstLine(value)}`, LABEL_MAX_LENGTH)
  }
  return name
}

// Pairs every tool call in a run of messages with its result.
export const buildJournalSteps = (messages: Fl0wMessage[]): JournalStep[] => {
  const results = new Map<string, ToolResultPart>()
  for (const { message } of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === "tool-result") results.set(part.toolCallId, part)
    }
  }

  const steps: JournalStep[] = []
  for (const { message } of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type !== "tool-call" || isStandaloneTool(part.toolName)) continue
      const result = results.get(part.toolCallId)
      steps.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        result,
        status: !result ? "pending" : isToolResultError(result) ? "error" : "ok",
      })
    }
  }
  return steps
}

export type DiffStats = { added: number, removed: number }

const splitLines = (text: string): string[] => text === "" ? [] : text.split("\n")

// Counts changed lines between two strings, ignoring the lines they share at either end.
export const diffStats = (oldText: string, newText: string): DiffStats => {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let end = 0
  while (
    end < oldLines.length - start
    && end < newLines.length - start
    && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
  ) end++
  return { added: newLines.length - start - end, removed: oldLines.length - start - end }
}

const patchStats = (patch: string): DiffStats => {
  const stats = { added: 0, removed: 0 }
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) stats.added++
    else if (line.startsWith("-")) stats.removed++
  }
  return stats
}

const patchFiles = (patch: string): string[] =>
  [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]!.trim())

const basename = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path

const hostname = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

type Phrase = {
  past: string
  present: string
  // Plural noun used when several calls of the same kind merge, e.g. "read 3 files".
  plural: string
  objects: string[]
  stats?: DiffStats
}

const phraseFor = (step: JournalStep): Phrase => {
  const { input } = step
  const name = bareToolName(step.toolName)
  const field = (key: string) => readStringField(input, key)?.trim() ?? ""
  const short = (value: string) => truncateLine(firstLine(value), OBJECT_MAX_LENGTH)

  switch (name) {
    case "read":
      return { past: "read", present: "reading", plural: "files", objects: [basename(field("filePath"))] }
    case "read_full_tool_output":
      return { past: "read", present: "reading", plural: "outputs", objects: ["the full output"] }
    case "grep":
      return { past: "searched for", present: "searching for", plural: "patterns", objects: [`"${short(field("pattern"))}"`] }
    case "glob":
      return { past: "looked for", present: "looking for", plural: "patterns", objects: [short(field("pattern"))] }
    case "list_dir":
      return { past: "looked in", present: "looking in", plural: "folders", objects: [basename(field("path") || ".")] }
    case "bash":
      return { past: "ran", present: "running", plural: "commands", objects: [short(field("command"))] }
    case "edit":
      return {
        past: "edited",
        present: "editing",
        plural: "files",
        objects: [basename(field("filePath"))],
        stats: diffStats(readStringField(input, "oldString") ?? "", readStringField(input, "newString") ?? ""),
      }
    case "write":
      return {
        past: "wrote",
        present: "writing",
        plural: "files",
        objects: [basename(field("filePath"))],
        stats: { added: splitLines(readStringField(input, "content") ?? "").length, removed: 0 },
      }
    case "apply_patch": {
      const patch = readStringField(input, "patchText") ?? ""
      const files = patchFiles(patch).map(basename)
      return { past: "patched", present: "patching", plural: "files", objects: files.length ? files : ["files"], stats: patchStats(patch) }
    }
    case "webfetch":
      return { past: "fetched", present: "fetching", plural: "pages", objects: [hostname(field("url"))] }
    case "websearch":
      return { past: "searched the web for", present: "searching the web for", plural: "queries", objects: [`"${short(field("query"))}"`] }
    case "load_skill":
      return { past: "loaded skill", present: "loading skill", plural: "skills", objects: [field("name")] }
    default:
      return { past: "used", present: "using", plural: "tools", objects: [name] }
  }
}

const formatStats = ({ added, removed }: DiffStats): string => `(+${added} −${removed})`

// Builds the plain-language sentence for a burst of steps: same-kind calls merge, in-flight steps
// read in the present tense, and failures are counted at the end.
export const composeSentence = (steps: JournalStep[]): SentenceFragment[] => {
  type Group = Phrase & { pending: boolean }
  const groups: Group[] = []
  for (const step of steps) {
    const phrase = phraseFor(step)
    const pending = step.status === "pending"
    const group = groups.find((candidate) => candidate.past === phrase.past && candidate.pending === pending)
    if (!group) {
      groups.push({ ...phrase, objects: [...phrase.objects], pending })
      continue
    }
    group.objects.push(...phrase.objects)
    if (phrase.stats) {
      const stats = group.stats ?? { added: 0, removed: 0 }
      group.stats = { added: stats.added + phrase.stats.added, removed: stats.removed + phrase.stats.removed }
    }
  }

  const phrases = groups.map((group): SentenceFragment[] => {
    const objects = [...new Set(group.objects.filter(Boolean))]
    const verb = group.pending ? group.present : group.past
    const nouns: SentenceFragment[] = objects.length > 2
      ? [{ text: `${objects.length} ${group.plural}` }]
      : objects.flatMap((object, index) => [
        ...(index > 0 ? [{ text: " and " }] : []),
        { text: object, noun: true as const },
      ])
    return [
      { text: `${verb} ` },
      ...nouns,
      ...(group.stats ? [{ text: ` ${formatStats(group.stats)}` }] : []),
    ]
  })

  const fragments = phrases.flatMap((phrase, index) => {
    if (index === 0) return phrase
    const isLast = index === phrases.length - 1
    const joiner = groups[index]!.pending
      ? ", now "
      : isLast ? (phrases.length > 2 ? ", and " : " and ") : ", "
    return [{ text: joiner }, ...phrase]
  })

  const failed = steps.filter((step) => step.status === "error").length
  if (failed > 0) fragments.push({ text: ` (${failed} failed)` })
  if (steps.some((step) => step.status === "pending")) fragments.push({ text: "…" })
  return fragments
}

export const sentenceText = (fragments: SentenceFragment[]): string => fragments.map((fragment) => fragment.text).join("")
