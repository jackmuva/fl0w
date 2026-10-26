import { syntaxStyle } from "../../lib/syntax-style"
import type { ToolViewProps } from "../../../models/ui"
import { MessageFrame } from "./MessageFrame"

type MarkdownToolViewProps = ToolViewProps & {
  content: string
  subtitle?: string
}

export const MarkdownToolView = ({
  toolName,
  content,
  subtitle,
  isError,
}: MarkdownToolViewProps) => (
  <MessageFrame title={toolName} subtitle={subtitle}>
    {isError ? (
      <text fg="#f7768e">{content}</text>
    ) : (
      <markdown content={content} syntaxStyle={syntaxStyle} />
    )}
  </MessageFrame>
)
