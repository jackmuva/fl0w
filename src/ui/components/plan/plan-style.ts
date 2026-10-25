import type { PlanStepProgress } from "../../lib/format/message"
import { GREEN_FG, ORANGE_FG } from "../primitives/MessageFrame"
import { EDGE_FG } from "../primitives/WorkflowEdge"

export type PlanStepState = "done" | "current" | "pending"

export const PLAN_PENDING_FG = "#565f89"

export const PLAN_STEP_GLYPH: Record<PlanStepState, string> = {
  done: "●",
  current: "◉",
  pending: "○",
}

export const PLAN_STEP_FG: Record<PlanStepState, string> = {
  done: GREEN_FG,
  current: ORANGE_FG,
  pending: PLAN_PENDING_FG,
}

export const planEdgeColor = (above: PlanStepState) => (above === "done" ? GREEN_FG : EDGE_FG)

// The first unfinished step is the one being worked on.
export const planStepStates = (steps: PlanStepProgress[]): PlanStepState[] => {
  const current = steps.findIndex((step) => !step.done)
  return steps.map((step, index) => (step.done ? "done" : index === current ? "current" : "pending"))
}
