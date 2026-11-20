import type { ToolViewProps } from "../../../models/ui"
import { callTitle, looksLikeMarkdown } from "../../lib/format/message"
import { CodeToolView } from "../primitives/CodeToolView"
import { DefaultToolView } from "../primitives/DefaultToolView"
import { MarkdownToolView } from "../primitives/MarkdownToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { selectionColors, theme } from "../../theme"

export const DefaultToolCallView = (props: ToolViewProps) => {
  const summary = props.input != null
    ? JSON.stringify(props.input, null, 2)
    : ""

  if (summary.includes("\n") || summary.length > 80) {
    return (
      <CodeToolView
        {...props}
        toolName={callTitle(props.toolName)}
        content={summary}
        filetype="json"
      />
    )
  }

  return (
    <MessageFrame title={callTitle(props.toolName)} subtitle={summary || undefined}>
      <text {...selectionColors} fg={theme.ink}>Running tool...</text>
    </MessageFrame>
  )
}

export const SmartDefaultToolResultView = (props: ToolViewProps) => {
  if (props.isError) return <DefaultToolView {...props} />
  if (looksLikeMarkdown(props.text) && props.text.length > 120) {
    return <MarkdownToolView {...props} content={props.text} />
  }
  if (props.text.includes("\n") && props.text.length > 80) {
    return (
      <CodeToolView
        {...props}
        content={props.text}
        filetype="plaintext"
      />
    )
  }
  return <DefaultToolView {...props} />
}
