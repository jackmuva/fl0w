import type { PlanProgress } from "../../lib/format/message"
import { CREAM_FG, GREEN_FG } from "../primitives/MessageFrame"
import { EDGE_FG } from "../primitives/WorkflowEdge"
import { PLAN_PENDING_FG, PLAN_STEP_FG, PLAN_STEP_GLYPH, planEdgeColor, planStepStates } from "./plan-style"

export const PLAN_SIDEBAR_WIDTH = 36
// The sidebar is hidden once it would take more than half the terminal, so the chat keeps its room.
export const fitsPlanSidebar = (terminalWidth: number) => PLAN_SIDEBAR_WIDTH <= terminalWidth / 2

// Keep only the first line of the description; it wraps and is clipped after STEP_MAX_LINES so the start always shows.
const STEP_MAX_LINES = 2
const stepHeadline = (description: string) => description.trim().split("\n")[0]!.trim()

type PlanSidebarProps = {
  progress: PlanProgress
}

// Latest plan drawn as a vertical workflow: one node per step, joined by edges.
export const PlanSidebar = ({ progress }: PlanSidebarProps) => {
  const { steps } = progress
  const states = planStepStates(steps)
  const done = steps.filter((step) => step.done).length
  const complete = done === steps.length

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width={PLAN_SIDEBAR_WIDTH}
      height="100%"
      border={["left"]}
      borderColor={EDGE_FG}
      paddingLeft={1}
      marginLeft={1}
    >
      <text fg={complete ? GREEN_FG : CREAM_FG} flexShrink={0}>
        <strong>{progress.title ?? "Plan"}</strong>
      </text>
      <text fg={complete ? GREEN_FG : PLAN_PENDING_FG} flexShrink={0}>
        {complete ? `✓ complete · ${steps.length} steps` : `${done}/${steps.length} complete`}
      </text>
      <scrollbox flexGrow={1} flexShrink={1} minHeight={0} width="100%" marginTop={1}>
        {steps.map((step, index) => {
          const state = states[index]!
          return (
            <box key={step.index} flexDirection="column" flexShrink={0} width="100%">
              {index > 0 && (
                <text fg={planEdgeColor(states[index - 1]!)} selectable={false}>{" │"}</text>
              )}
              <box flexDirection="row" width="100%">
                <box flexShrink={0} width={3}>
                  <text fg={PLAN_STEP_FG[state]}>{` ${PLAN_STEP_GLYPH[state]}`}</text>
                </box>
                <box flexGrow={1} flexShrink={1} maxHeight={STEP_MAX_LINES} overflow="hidden">
                  <text
                    fg={state === "pending" ? PLAN_PENDING_FG : state === "done" ? GREEN_FG : undefined}
                    wrapMode="word"
                  >
                    {`${step.index}. ${stepHeadline(step.description)}`}
                  </text>
                </box>
              </box>
            </box>
          )
        })}
      </scrollbox>
    </box>
  )
}
