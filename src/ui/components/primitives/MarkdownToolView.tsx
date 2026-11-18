import { LinkableMarkdown } from "./LinkableMarkdown"
import type { ToolViewProps } from "../../../models/ui"
import { MessageFrame } from "./MessageFrame"
import { theme } from "../../theme"

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
      <text fg={theme.error}>{content}</text>
    ) : (
      <LinkableMarkdown content={content} />
    )}
  </MessageFrame>
)
