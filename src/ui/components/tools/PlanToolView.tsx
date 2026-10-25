import { createContext, useContext } from "react"
import type { ToolViewProps } from "../../../models/ui"
import {
  callTitle,
  readNumberField,
  readPlanSteps,
  readStringField,
  type PlanProgress,
} from "../../lib/format/message"
import { GREEN_FG, MessageFrame } from "../primitives/MessageFrame"
import { PLAN_PENDING_FG, PLAN_STEP_FG, PLAN_STEP_GLYPH, planStepStates } from "../plan/plan-style"

const ERROR_FG = "#f7768e"

// Progress of the session's latest plan; only that plan's frame tracks completion.
export const PlanProgressContext = createContext<PlanProgress | undefined>(undefined)

export const PlanToolCallView = (props: ToolViewProps) => {
  const count = readPlanSteps(props.input).length
  return (
    <MessageFrame title={callTitle(props.toolName)}>
      <text>{count > 0 ? `Creating plan with ${count} steps…` : "Creating plan…"}</text>
    </MessageFrame>
  )
}

export const PlanToolResultView = (props: ToolViewProps) => {
  const progress = useContext(PlanProgressContext)
  const title = readStringField(props.input, "title")?.trim() || "Plan"
  const steps = readPlanSteps(props.input)

  if (props.isError || steps.length === 0) {
    return (
      <MessageFrame title={title}>
        <text fg={ERROR_FG}>{props.text || "Plan could not be created"}</text>
      </MessageFrame>
    )
  }

  const tracked = progress && progress.toolCallId === props.toolCallId ? progress.steps : undefined
  if (!tracked) {
    return (
      <MessageFrame title={title} subtitle={`${steps.length} steps · superseded`}>
        {steps.map((step) => (
          <text key={step.index} fg={PLAN_PENDING_FG}>{`${step.index}. ${step.description}`}</text>
        ))}
      </MessageFrame>
    )
  }

  const states = planStepStates(tracked)
  const done = tracked.filter((step) => step.done).length
  return (
    <MessageFrame title={title} subtitle={`${done}/${tracked.length} complete`}>
      {tracked.map((step, index) => {
        const state = states[index]!
        return (
          <text key={step.index}>
            <span fg={PLAN_STEP_FG[state]}>{PLAN_STEP_GLYPH[state]}</span>
            {` ${step.index}. ${step.description}`}
          </text>
        )
      })}
    </MessageFrame>
  )
}

export const MarkStepCompleteToolCallView = () => null

export const MarkStepCompleteToolResultView = (props: ToolViewProps) => {
  if (props.isError) return <text fg={ERROR_FG}>{props.text}</text>
  const index = readNumberField(props.input, "index", 0)
  const note = readStringField(props.input, "note")
  return (
    <text>
      <span fg={GREEN_FG}>✓</span> {`Step ${index || "?"} complete${note ? ` — ${note}` : ""}`}
    </text>
  )
}
