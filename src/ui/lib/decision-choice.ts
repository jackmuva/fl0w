import type { ChoiceProbabilities } from "../../models/agent"

// Tools reached via the initial routing step carry probabilities keyed by route name.
const ROUTE_CHOICE_BY_TOOL: Record<string, string> = {
  AskQuestion: "clarifyTask",
  CreatePlan: "createPlan",
}

export const selectedDecisionChoice = (
  probabilities: ChoiceProbabilities,
  toolName: string,
): string =>
  toolName in probabilities ? toolName : (ROUTE_CHOICE_BY_TOOL[toolName] ?? toolName)
