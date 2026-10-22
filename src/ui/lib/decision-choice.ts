import type { ChoiceProbabilities } from "../../models/agent"

// Tools reached via the initial routing step carry probabilities keyed by route name.
const ROUTE_CHOICE_BY_TOOL: Record<string, string> = {
  "default/ask_question": "clarifyTask",
  "default/create_plan": "createPlan",
}

export const TERMINAL_DECISION_CHOICES = new Set(["taskCompleted", "notPossible"])

export const terminalDecisionLabel = (choice: string): string | null => {
  if (choice === "taskCompleted") return "Task Complete"
  if (choice === "notPossible") return "Unable to complete the task with given tools"
  return null
}

export const selectedDecisionChoice = (
  probabilities: ChoiceProbabilities,
  toolName: string,
): string =>
  toolName in probabilities ? toolName : (ROUTE_CHOICE_BY_TOOL[toolName] ?? toolName)
