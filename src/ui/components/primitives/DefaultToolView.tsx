import { MessageFrame } from "./MessageFrame"
import type { ToolViewProps } from "../../../models/ui"
import { theme } from "../../theme"

export const DefaultToolView = ({ toolName, text, isError }: ToolViewProps) => (
  <MessageFrame title={toolName}>
    <text fg={isError ? theme.error : theme.ink}>{text}</text>
  </MessageFrame>
)
