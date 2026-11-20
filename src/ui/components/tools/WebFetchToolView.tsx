import type { ToolViewProps } from "../../../models/ui"
import { callTitle, looksLikeMarkdown, readStringField } from "../../lib/format/message"
import { CodeToolView } from "../primitives/CodeToolView"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { selectionColors, theme } from "../../theme"

export const WebFetchToolCallView = (props: ToolViewProps) => {
  const url = readStringField(props.input, "url") ?? ""
  const format = readStringField(props.input, "format") ?? "markdown"

  return (
    <MessageFrame title={callTitle(props.toolName)} subtitle={`${url} (${format})`}>
      <text {...selectionColors} fg={theme.ink}>Fetching URL...</text>
    </MessageFrame>
  )
}

export const WebFetchToolResultView = (props: ToolViewProps) => {
  const format = readStringField(props.input, "format") ?? "markdown"
  const url = readStringField(props.input, "url")

  if (format === "markdown" || looksLikeMarkdown(props.text)) {
    return <MarkdownToolView {...props} content={props.text} subtitle={url} />
  }

  if (format === "html") {
    return (
      <CodeToolView
        {...props}
        content={props.text}
        filetype="html"
        subtitle={url}
      />
    )
  }

  return (
    <CodeToolView
      {...props}
      content={props.text}
      filetype="plaintext"
      subtitle={url}
    />
  )
}
