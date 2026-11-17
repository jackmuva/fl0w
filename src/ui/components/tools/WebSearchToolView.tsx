import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { theme } from "../../theme"

export const WebSearchToolCallView = (props: ToolViewProps) => {
  const query = readStringField(props.input, "query") ?? ""

  return (
    <MessageFrame title={callTitle(props.toolName)} subtitle={query}>
      <text fg={theme.ink}>Searching the web...</text>
    </MessageFrame>
  )
}

export const WebSearchToolResultView = (props: ToolViewProps) => (
  <MarkdownToolView
    {...props}
    content={props.text}
    subtitle={readStringField(props.input, "query")}
  />
)
