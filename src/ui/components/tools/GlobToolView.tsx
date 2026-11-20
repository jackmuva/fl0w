import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { ListToolView } from "../primitives/ListToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { selectionColors, theme } from "../../theme"

export const GlobToolCallView = (props: ToolViewProps) => {
  const pattern = readStringField(props.input, "pattern") ?? ""
  const path = readStringField(props.input, "path") ?? "."

  return (
    <MessageFrame title={callTitle(props.toolName)} subtitle={`${path} · ${pattern}`}>
      <text {...selectionColors} fg={theme.ink}>Searching files...</text>
    </MessageFrame>
  )
}

export const GlobToolResultView = (props: ToolViewProps) => {
  const items = props.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("("))

  return (
    <ListToolView
      {...props}
      items={items}
      subtitle={readStringField(props.input, "path") ?? readStringField(props.input, "pattern")}
    />
  )
}
