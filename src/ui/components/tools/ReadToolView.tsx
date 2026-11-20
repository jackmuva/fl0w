import type { ToolViewProps } from "../../../models/ui"
import {
  filetypeFromPath,
  looksLikeLineNumberedOutput,
  parseLineNumberedContent,
  readNumberField,
  readStringField,
  callTitle,
} from "../../lib/format/message"
import { CodeToolView } from "../primitives/CodeToolView"
import { ListToolView } from "../primitives/ListToolView"
import { MessageFrame } from "../primitives/MessageFrame"
import { selectionColors, theme } from "../../theme"

export const ReadToolCallView = ({ toolName, input }: ToolViewProps) => {
  const filePath = readStringField(input, "filePath") ?? "unknown file"
  const offset = readNumberField(input, "offset", 1)
  const limit = readNumberField(input, "limit", 2000)

  return (
    <MessageFrame
      title={callTitle(toolName)}
      subtitle={`${filePath} (offset ${offset}, limit ${limit})`}
    >
      <text {...selectionColors} fg={theme.ink}>Reading file...</text>
    </MessageFrame>
  )
}

export const ReadToolResultView = (props: ToolViewProps) => {
  const filePath = readStringField(props.input, "filePath")
  const filetype = filetypeFromPath(filePath)

  if (looksLikeLineNumberedOutput(props.text)) {
    const { content, startLine } = parseLineNumberedContent(props.text)
    return (
      <CodeToolView
        {...props}
        content={content}
        filetype={filetype}
        subtitle={filePath}
        startLine={startLine}
      />
    )
  }

  const lines = props.text.split("\n").filter(Boolean)
  if (lines.length > 1 && !props.text.includes(":")) {
    return (
      <ListToolView
        {...props}
        items={lines}
        subtitle={filePath ?? "directory listing"}
      />
    )
  }

  return (
    <CodeToolView
      {...props}
      content={props.text}
      filetype={filetype}
      subtitle={filePath}
    />
  )
}
