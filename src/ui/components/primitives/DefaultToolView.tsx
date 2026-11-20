import { MessageFrame } from "./MessageFrame"
import type { ToolViewProps } from "../../../models/ui"
import { selectionColors, theme } from "../../theme"

export const DefaultToolView = ({ toolName, text, isError }: ToolViewProps) => (
  <MessageFrame title={toolName}>
    <text {...selectionColors} fg={isError ? theme.error : theme.ink}>{text}</text>
  </MessageFrame>
)
