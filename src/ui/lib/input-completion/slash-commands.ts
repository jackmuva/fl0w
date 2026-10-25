import type { CompletionItem, SlashCommandDefinition } from "../../../models/ui"
import { filterByFuzzyName } from "./fuzzy-match"

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: "clear",
    description: "Clear the saved conversation for this workspace",
  },
  {
    name: "sessions",
    description: "Choose a saved session to resume",
  },
  {
    name: "configure",
    description: "Choose which models, MCPs, skills, tools, and AGENTS.md to enable",
  },
  {
    name: "generate",
    description: "Create a workflow from a saved session",
  },
  {
    name: "workflow",
    description: "Run a saved workflow with additional instructions",
  },
]

export type SlashCommandActions = {
  clearSession: () => void
  resumeSession: () => void
  configureCapabilities: () => void
  generateWorkflow: () => void
  runWorkflow: () => void
}

export type SlashCommandHandlers = SlashCommandActions & {
  clearInput: () => void
}

export const getSlashCompletions = (query: string): CompletionItem[] => {
  const matches = query.length === 0
    ? [...SLASH_COMMANDS].sort((left, right) => left.name.localeCompare(right.name))
    : filterByFuzzyName(SLASH_COMMANDS, query)

  return matches.map((command) => ({
    id: `slash:${command.name}`,
    label: `/${command.name}`,
    description: command.description,
    insertText: `/${command.name}`,
    value: command,
  }))
}

export const findSlashCommand = (text: string): SlashCommandDefinition | null => {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return null

  const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase()
  if (!name) return null

  return SLASH_COMMANDS.find((command) => command.name === name) ?? null
}

export const executeSlashCommand = (
  name: string,
  handlers: SlashCommandHandlers,
): boolean => {
  switch (name) {
    case "clear":
      handlers.clearSession()
      handlers.clearInput()
      return true
    case "sessions":
      handlers.resumeSession()
      handlers.clearInput()
      return true
    case "configure":
      handlers.configureCapabilities()
      handlers.clearInput()
      return true
    case "generate":
      handlers.generateWorkflow()
      handlers.clearInput()
      return true
    case "workflow":
      handlers.runWorkflow()
      handlers.clearInput()
      return true
    default:
      return false
  }
}
