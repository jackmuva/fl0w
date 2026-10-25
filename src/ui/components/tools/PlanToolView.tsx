import { createContext, useContext } from "react"
import type { ToolViewProps } from "../../../models/ui"
import {
  callTitle,
  concatenateSubtitle,
  parsePlanSteps,
  readNumberField,
  readPlanSteps,
  readStringField,
  type PlanProgress,
} from "../../lib/format/message"
import { ListToolView } from "../primitives/ListToolView"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { GREEN_FG, MessageFrame } from "../primitives/MessageFrame"

const PENDING_FG = "#565f89"

// Progress of the session's latest plan; only that plan's frame renders checkboxes.
export const PlanProgressContext = createContext<PlanProgress | undefined>(undefined)

const renderPlanView = (props: ToolViewProps, planText: string, title = "Workflow plan") => {
  const steps = parsePlanSteps(planText)
  const subtitle = concatenateSubtitle(steps) || planText.split("\n").find(Boolean)?.trim()

  if (steps.length > 0) {
    return (
      <ListToolView
        {...props}
        toolName={title}
        items={steps}
        subtitle={subtitle}
        text={props.text}
      />
    )
  }

  return (
    <MarkdownToolView
      {...props}
      toolName={title}
      content={planText}
      subtitle={subtitle}
    />
  )
}

export const PlanToolCallView = (props: ToolViewProps) => {
  return (
    <MessageFrame title={callTitle(props.toolName)}>
      <text>Creating workflow plan...</text>
    </MessageFrame>
  )
}

export const PlanToolResultView = (props: ToolViewProps) => {
  const progress = useContext(PlanProgressContext)
  const title = readStringField(props.input, "title") || "Workflow plan"

  if (!props.isError) {
    const tracked = progress && progress.toolCallId === props.toolCallId ? progress.steps : undefined
    const steps = tracked ?? readPlanSteps(props.input).map((step) => ({ ...step, done: false }))
    if (steps.length > 0) {
      const done = steps.filter((step) => step.done).length
      return (
        <ListToolView
          {...props}
          toolName={title}
          items={steps.map((step) => `${step.index}. ${step.description}`)}
          markers={tracked ? steps.map((step) => (step.done ? "☑" : "☐")) : undefined}
          markerColors={tracked ? steps.map((step) => (step.done ? GREEN_FG : PENDING_FG)) : undefined}
          subtitle={tracked ? `${done}/${steps.length} complete` : `${steps.length} steps`}
        />
      )
    }
  }

  const planText = props.text || readStringField(props.input, "plan") || ""
  return renderPlanView(props, planText, title)
}

export const MarkStepCompleteToolCallView = () => null

export const MarkStepCompleteToolResultView = (props: ToolViewProps) => {
  if (props.isError) return <text fg="#f7768e">{props.text}</text>
  const index = readNumberField(props.input, "index", 0)
  const note = readStringField(props.input, "note")
  return (
    <text>
      <span fg={GREEN_FG}>✓</span> {`Step ${index || "?"} complete${note ? ` — ${note}` : ""}`}
    </text>
  )
}
