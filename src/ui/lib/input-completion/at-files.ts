import type { CompletionItem } from "../../../models/ui"
import { fuzzyContains, fuzzyScore } from "./fuzzy-match"
import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { readFile } from "node:fs/promises"
import type { ModelMessage } from "ai"

const FILE_REFERENCE_PATTERN = /@([^\s@]+)/g
const MAX_ATTACHMENT_BYTES = 32_000
const EXCLUDED_DIRS = new Set(["node_modules", "dist"])

let cachedFiles: string[] | null = null
let cachedRoot: string | null = null

export type FileAttachment = {
  path: string
  content: string
}

export const formatAttachmentBlock = (attachment: FileAttachment): string =>
  `[Attached: ${attachment.path}]\n${attachment.content}`

export const parseUserAttachments = (text: string): { prompt: string; attachments: FileAttachment[] } => {
  const attachmentStart = text.indexOf("\n\n[Attached:")
  if (attachmentStart === -1) {
    return { prompt: text, attachments: [] }
  }

  const prompt = text.slice(0, attachmentStart)
  const attachmentSection = text.slice(attachmentStart + 2)
  const attachments: FileAttachment[] = []

  for (const block of attachmentSection.split(/\n\n(?=\[Attached:)/)) {
    const match = block.match(/^\[Attached: ([^\]]+)\]\n([\s\S]*)$/)
    if (match) {
      attachments.push({ path: match[1]!, content: match[2]! })
    }
  }

  return { prompt, attachments }
}

const readAttachment = async (path: string, root = process.cwd()): Promise<FileAttachment | null> => {
  const absolutePath = join(root, path)
  try {
    const content = await readFile(absolutePath, "utf8")
    if (content.length > MAX_ATTACHMENT_BYTES) {
      return {
        path,
        content: `${content.slice(0, MAX_ATTACHMENT_BYTES)}\n\n[Truncated: file exceeds ${MAX_ATTACHMENT_BYTES} characters]`,
      }
    }
    return { path, content }
  } catch {
    return null
  }
}

export const extractFileReferences = (text: string): string[] => {
  const references = new Set<string>()
  for (const match of text.matchAll(FILE_REFERENCE_PATTERN)) {
    const path = match[1]
    if (path) references.add(path)
  }
  return [...references]
}

export const resolveUserMessage = async (text: string): Promise<ModelMessage> => {
  const references = extractFileReferences(text)
  if (references.length === 0) {
    return { role: "user", content: text }
  }

  const attachments = (
    await Promise.all(references.map((path) => readAttachment(path)))
  ).filter((attachment): attachment is FileAttachment => attachment !== null)

  if (attachments.length === 0) {
    return { role: "user", content: text }
  }

  const attachmentText = attachments.map(formatAttachmentBlock).join("\n\n")

  return {
    role: "user",
    content: `${text}\n\n${attachmentText}`,
  }
}

const walkDirectory = async (dir: string, root: string, files: string[]): Promise<void> => {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || EXCLUDED_DIRS.has(entry.name)) continue

    const absolutePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, root, files)
      continue
    }

    if (entry.isFile()) {
      files.push(relative(root, absolutePath))
    }
  }
}

export const listWorkspaceFiles = async (root = process.cwd()): Promise<string[]> => {
  if (cachedFiles && cachedRoot === root) return cachedFiles

  const files: string[] = []
  await walkDirectory(root, root, files)
  files.sort()

  cachedFiles = files
  cachedRoot = root
  return files
}

export const invalidateFileIndex = () => {
  cachedFiles = null
  cachedRoot = null
}

export const filterFiles = (files: string[], query: string, limit = 15): string[] => {
  const normalized = query.toLowerCase()
  let matches = files.filter((file) => fuzzyContains(file, normalized))
  const hasPrefixMatch = matches.some((file) => fuzzyScore(file, normalized) === 0)
  if (hasPrefixMatch) {
    matches = matches.filter((file) => fuzzyScore(file, normalized) === 0)
  } else {
    const hasSubstringMatch = matches.some((file) => fuzzyScore(file, normalized) === 1)
    if (hasSubstringMatch) {
      matches = matches.filter((file) => fuzzyScore(file, normalized) === 1)
    }
  }
  matches.sort((left, right) => {
    const scoreA = fuzzyScore(left, normalized)
    const scoreB = fuzzyScore(right, normalized)
    if (scoreA !== scoreB) return scoreA - scoreB
    const pathA = scoreFileMatch(left, normalized)
    const pathB = scoreFileMatch(right, normalized)
    if (pathA !== pathB) return pathA - pathB
    return left.localeCompare(right)
  })
  return matches.slice(0, limit)
}

const scoreFileMatch = (file: string, query: string): number => {
  const lower = file.toLowerCase()
  if (lower.startsWith(query)) return 0
  if (lower.includes(`/${query}`)) return 1
  const basename = lower.split("/").pop() ?? lower
  if (basename.startsWith(query)) return 2
  return 3
}

export const getAtFileCompletions = async (query: string): Promise<CompletionItem[]> => {
  const files = await listWorkspaceFiles()
  return filterFiles(files, query).map((path) => ({
    id: `file:${path}`,
    label: path,
    description: "File",
    insertText: `@${path} `,
    value: path,
  }))
}
