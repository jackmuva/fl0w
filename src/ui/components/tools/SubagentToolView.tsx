import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { selectionColors, theme } from "../../theme"

export const SubagentToolCallView = (props: ToolViewProps) => (
  <MessageFrame title={callTitle(props.toolName)} subtitle={readStringField(props.input, "description")}>
    <text {...selectionColors} fg={theme.muted}>{readStringField(props.input, "prompt") ?? ""}</text>
  </MessageFrame>
)

export const SubagentToolResultView = (props: ToolViewProps) => (
  <MarkdownToolView {...props} content={props.text} subtitle={readStringField(props.input, "description")} />
)
