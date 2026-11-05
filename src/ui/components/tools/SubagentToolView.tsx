import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"

export const SubagentToolCallView = (props: ToolViewProps) => (
  <MessageFrame title={callTitle(props.toolName)} subtitle={readStringField(props.input, "description")}>
    <text fg="#565f89">{readStringField(props.input, "prompt") ?? ""}</text>
  </MessageFrame>
)

export const SubagentToolResultView = (props: ToolViewProps) => (
  <MarkdownToolView {...props} content={props.text} subtitle={readStringField(props.input, "description")} />
)
