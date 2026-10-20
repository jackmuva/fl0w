import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"

const renderAnswerView = (
  props: ToolViewProps,
  answer: string,
  title: string,
) => (
  <MarkdownToolView
    {...props}
    toolName={title}
    content={answer}
  />
)

// The answer body is shown by the result view; the call only marks that an answer was sent.
export const MessageAnswerToolCallView = (props: ToolViewProps) => {
  return (
    <MessageFrame title={callTitle(props.toolName)}>
      <text>Preparing answer...</text>
    </MessageFrame>
  )
}

export const MessageAnswerToolResultView = (props: ToolViewProps) => {
  const answer = props.text || readStringField(props.input, "answer") || ""
  return renderAnswerView(props, answer, callTitle(props.toolName))
}
