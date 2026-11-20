import type { ToolViewProps } from "../../../models/ui"
import { HighlightedCode } from "./HighlightedCode"
import { MessageFrame } from "./MessageFrame"
import { selectionColors, theme } from "../../theme"

type CodeToolViewProps = ToolViewProps & {
  content: string
  filetype?: string
  subtitle?: string
  startLine?: number
}

export const CodeToolView = ({
  toolName,
  content,
  filetype = "plaintext",
  subtitle,
  startLine = 1,
  isError,
}: CodeToolViewProps) => (
  <MessageFrame title={toolName} subtitle={subtitle}>
    {isError ? (
      <text {...selectionColors} fg={theme.error}>{content}</text>
    ) : (
      <HighlightedCode content={content} filetype={filetype} startLine={startLine} />
    )}
  </MessageFrame>
)
