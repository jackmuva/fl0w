import type { ModelMessage } from "ai"
import { useState } from "react"
import type { Fl0wMessage } from "../../../models/agent"
import { parseUserAttachments } from "../../lib/input-completion/at-files"
import { parseWorkflowPrompt } from "../../../services/workflow/build-message"
import { ASK_QUESTION_ACTION } from "../../../services/agent/utils/tool-utils"
import { renderToolCall, renderToolResult } from "../../tool-renderers"
import {
  firstLine,
  formatMessageContent,
  formatReasoningContent,
  formatToolResultText,
  isToolResultError,
  truncateLine,
  type ToolCallPart,
  type ToolResultPart,
} from "../../lib/format/message"
import { filetypeFromPath } from "../../lib/format/message"
import { ExpandableRow } from "./ExpandableRow"
import { HighlightedCode } from "./HighlightedCode"
import { syntaxStyle } from "../../lib/syntax-style"
import {
  AGENT_BORDER_COLOR,
  CREAM_FG,
  MessageFrame,
  MessageFrameKindContext,
} from "./MessageFrame"

const REASONING_PREVIEW_MAX_LENGTH = 72

const hasOnlyToolCalls = (message: ModelMessage): boolean => {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return false
  return message.content.length > 0 && message.content.every((part) => part.type === "tool-call")
}

const ToolCalls = ({ message }: { message: ModelMessage }) => {
  if (!Array.isArray(message.content)) return null
  const toolCalls = message.content.filter(
    (part): part is ToolCallPart => part.type === "tool-call" && part.toolName !== ASK_QUESTION_ACTION,
  )
  if (toolCalls.length === 0) return null

  return (
    <MessageFrameKindContext.Provider value="call">
      {toolCalls.map((toolCall, index) => (
        <box key={toolCall.toolCallId ?? index} paddingLeft={2}>
          {renderToolCall({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            input: toolCall.input,
            text: "",
          })}
        </box>
      ))}
    </MessageFrameKindContext.Provider>
  )
}

const ReasoningLine = ({ message }: { message: ModelMessage }) => {
  const [expanded, setExpanded] = useState(false)
  const reasoning = formatReasoningContent(message).trim()
  if (!reasoning) return null

  const hiddenLineCount = reasoning.split("\n").filter((line) => line.trim()).length - 1
  const preview = truncateLine(firstLine(reasoning), REASONING_PREVIEW_MAX_LENGTH)
  const suffix = hiddenLineCount > 0 ? ` (+${hiddenLineCount} lines)` : ""

  return (
    <box flexDirection="column" paddingLeft={2} marginBottom={1} width="100%">
      <ExpandableRow expanded={expanded} onToggle={() => setExpanded((value) => !value)}>
        <text fg={AGENT_BORDER_COLOR} selectable={false}>
          {expanded ? "✻ Thought" : `✻ Thought · ${preview}${suffix}`}
        </text>
      </ExpandableRow>
      {expanded && (
        <box border={["left"]} borderColor={AGENT_BORDER_COLOR} paddingLeft={1} width="100%">
          <text fg={AGENT_BORDER_COLOR}>{reasoning}</text>
        </box>
      )}
    </box>
  )
}

const UserLine = ({ text }: { text: string }) => (
  <box flexDirection="row" width="100%">
    <text fg={CREAM_FG} selectable={false} flexShrink={0}>{"› "}</text>
    <text flexGrow={1} flexShrink={1}>{text}</text>
  </box>
)

type MessageContentProps = {
  message: Fl0wMessage
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
  // Set when this message's tool calls are told by a journal entry instead.
  hideToolCalls?: boolean
}

export const MessageContent = ({ message: entry, toolCallInputs, hideToolCalls = false }: MessageContentProps) => {
  const { message, compacted } = entry
  const isAgent = message.role === "assistant" || message.role === "tool"

  if (compacted) {
    const text = formatMessageContent(message)
    if (!text) return null

    return (
      <box width="100%" paddingLeft={2}>
        <MessageFrameKindContext.Provider value="summary">
          <MessageFrame title="Conversation summary">
            <text>{text}</text>
          </MessageFrame>
        </MessageFrameKindContext.Provider>
      </box>
    )
  }

  if (message.role === "tool" && Array.isArray(message.content)) {
    return (
      <MessageFrameKindContext.Provider value="output">
        {message.content.map((part, index) => {
          if (part.type !== "tool-result") return null
          const toolResult = part as ToolResultPart

          const matchedCall = toolCallInputs.get(toolResult.toolCallId)
          return (
            <box key={toolResult.toolCallId ?? index} paddingLeft={2}>
              {renderToolResult({
                toolName: toolResult.toolName,
                toolCallId: toolResult.toolCallId,
                input: matchedCall?.input,
                output: toolResult.output,
                text: formatToolResultText(toolResult),
                isError: isToolResultError(toolResult),
              })}
            </box>
          )
        })}
      </MessageFrameKindContext.Provider>
    )
  }

  if (hasOnlyToolCalls(message)) return hideToolCalls ? null : <ToolCalls message={message} />

  const text = formatMessageContent(message)
  if (!text) {
    if (message.role !== "assistant") return null
    return (
      <>
        <ReasoningLine message={message} />
        {!hideToolCalls && <ToolCalls message={message} />}
      </>
    )
  }

  if (message.role === "user") {
    const workflow = parseWorkflowPrompt(text)
    if (workflow) {
      return (
        <box width="100%" paddingLeft={2}>
          <MessageFrameKindContext.Provider value="workflow">
            <MessageFrame title={workflow.title}>
              <text>{workflow.content}</text>
            </MessageFrame>
          </MessageFrameKindContext.Provider>
        </box>
      )
    }

    const { prompt, attachments } = parseUserAttachments(text)
    if (attachments.length > 0) {
      return (
        <box flexDirection="column" width="100%" marginBottom={1}>
          {prompt ? <UserLine text={prompt} /> : null}
          {attachments.map((attachment, index) => (
            <MessageFrameKindContext.Provider key={`${attachment.path}-${index}`} value="attachment">
              <box width="100%" paddingLeft={2}>
                <MessageFrame title={attachment.path}>
                  <HighlightedCode
                    content={attachment.content}
                    filetype={filetypeFromPath(attachment.path) ?? "plaintext"}
                  />
                </MessageFrame>
              </box>
            </MessageFrameKindContext.Provider>
          ))}
        </box>
      )
    }
  }

  return (
    <>
      {message.role === "assistant" && <ReasoningLine message={message} />}
      <box paddingLeft={isAgent ? 2 : 0} marginBottom={1} width="100%">
        {message.role === "assistant"
          ? <markdown content={text} syntaxStyle={syntaxStyle} />
          : message.role === "user" ? <UserLine text={text} /> : <text>{text}</text>}
      </box>
      {/* Assistant messages can mix text with tool calls; show the calls after the text. */}
      {message.role === "assistant" && !hideToolCalls && <ToolCalls message={message} />}
    </>
  )
}
