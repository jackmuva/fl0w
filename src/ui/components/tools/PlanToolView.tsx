import type { ToolViewProps } from "../../../models/ui"
import {
  callTitle,
  concatenateSubtitle,
  parsePlanSteps,
  readStringField,
} from "../../lib/format/message"
import { ListToolView } from "../primitives/ListToolView"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"

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
  const planText = props.text || readStringField(props.input, "plan") || ""
  return renderPlanView(props, planText)
}
