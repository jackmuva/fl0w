import type { ToolViewProps } from "../../../models/ui"
import { callTitle, readStringField } from "../../lib/format/message"
import { ListToolView } from "../primitives/ListToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { theme } from "../../theme"

export const ListDirToolCallView = (props: ToolViewProps) => {
  const path = readStringField(props.input, "path") ?? "."

  return (
    <MessageFrame title={callTitle(props.toolName)} subtitle={path}>
      <text fg={theme.ink}>Listing directory...</text>
    </MessageFrame>
  )
}

export const ListDirToolResultView = (props: ToolViewProps) => {
  const items = props.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("("))

  return (
    <ListToolView
      {...props}
      items={items}
      subtitle={readStringField(props.input, "path")}
    />
  )
}
