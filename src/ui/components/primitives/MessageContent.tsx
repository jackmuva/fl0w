import type { ModelMessage } from "ai"
import type { Fl0wMessage } from "../../../models/agent"
import { parseUserAttachments } from "../../lib/input-completion/at-files"
import { parseWorkflowPrompt } from "../../../services/workflow/build-message"
import { parseDecisionMessage, type DecisionMessagePayload } from "../../../services/agent/utils/fl0w-message"
import { ASK_QUESTION_ACTION } from "../../../services/agent/utils/tools"
import { renderToolCall, renderToolResult } from "../../tool-renderers"
import {
  formatToolResultText,
  isToolResultError,
  type ToolCallPart,
  type ToolResultPart,
} from "../../lib/format/message"
import { filetypeFromPath } from "../../lib/format/message"
import {
  selectedDecisionChoice,
  TERMINAL_DECISION_CHOICES,
  terminalDecisionLabel,
} from "../../lib/decision-choice"
import { ChoiceProbabilities } from "./ChoiceProbabilities"
import { HighlightedCode } from "./HighlightedCode"
import { syntaxStyle } from "../../syntax-style"
import {
  AGENT_BORDER_COLOR,
  DecisionBackdropContext,
  MessageFrame,
  MessageFrameKindContext,
} from "./MessageFrame"

const formatMessageContent = (message: ModelMessage): string => {
  if (typeof message.content === "string") return message.content

  const parts: string[] = []
  for (const part of message.content) {
    switch (part.type) {
      case "text":
      case "reasoning":
        parts.push(part.text)
        break
      case "image":
        parts.push("[image]")
        break
      case "file":
        if (part.mediaType.startsWith("image")) {
          parts.push(`[image: ${part.filename ?? part.mediaType}]`)
        } else {
          parts.push(`[file: ${part.filename ?? part.mediaType}]`)
        }
        break
      case "tool-call":
      case "tool-result":
        break
      default:
        parts.push(`[${part.type}]`)
    }
  }
  return parts.join("")
}

const hasOnlyToolCalls = (message: ModelMessage): boolean => {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return false
  return message.content.length > 0 && message.content.every((part) => part.type === "tool-call")
}

type MessageContentProps = {
  message: Fl0wMessage
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
  decision?: DecisionMessagePayload | null
}

const MAX_GHOSTS = 3

export const MessageContent = ({ message: entry, toolCallInputs, decision }: MessageContentProps) => {
  const { message, frame } = entry
  const isAgent = message.role === "assistant" || message.role === "tool"

  if (frame === "summary") {
    const text = formatMessageContent(message)
    if (!text) return null

    return (
      <box width="100%" marginBottom={1}>
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
            <box key={toolResult.toolCallId ?? index}>
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

  if (hasOnlyToolCalls(message) && Array.isArray(message.content)) {
    const selectedChoice = decision
      ? selectedDecisionChoice(decision.probabilities, decision.selectedTool)
      : undefined
    const ghosts = decision
      ? Object.entries(decision.probabilities)
          .filter(([choice]) => choice !== selectedChoice)
          .sort(([, a], [, b]) => b - a)
          .slice(0, MAX_GHOSTS)
          .map(([choice, probability]) => ({ choice, probability }))
      : []

    return (
      <MessageFrameKindContext.Provider value="call">
        {message.content.map((part, index) => {
          if (part.type !== "tool-call") return null
          const toolCall = part as ToolCallPart

          if (toolCall.toolName === ASK_QUESTION_ACTION) return null

          return (
            <box key={toolCall.toolCallId ?? index}>
              <DecisionBackdropContext.Provider
                value={toolCall.toolName === decision?.selectedTool ? ghosts : []}
              >
                {renderToolCall({
                  toolName: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  input: toolCall.input,
                  text: "",
                })}
              </DecisionBackdropContext.Provider>
            </box>
          )
        })}
      </MessageFrameKindContext.Provider>
    )
  }

  const text = formatMessageContent(message)
  if (!text) return null

  if (
    message.role === "assistant"
    && decision
    && TERMINAL_DECISION_CHOICES.has(decision.selectedTool)
    && terminalDecisionLabel(decision.selectedTool) === text
  ) {
    return (
      <box width="100%" marginBottom={1}>
        <MessageFrameKindContext.Provider value="call">
          <ChoiceProbabilities
            probabilities={decision.probabilities}
            selected={selectedDecisionChoice(decision.probabilities, decision.selectedTool)}
          />
          <box
            border={["left"]}
            borderColor={AGENT_BORDER_COLOR}
            paddingLeft={1}
            marginTop={1}
            width="100%"
          >
            <text>{text}</text>
          </box>
        </MessageFrameKindContext.Provider>
      </box>
    )
  }

  if (message.role === "user") {
    const workflow = parseWorkflowPrompt(text)
    if (workflow) {
      return (
        <box width="100%" marginBottom={1}>
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
          {prompt ? <text>{prompt}</text> : null}
          {attachments.map((attachment, index) => (
            <MessageFrameKindContext.Provider key={`${attachment.path}-${index}`} value="attachment">
              <MessageFrame title={attachment.path}>
                <HighlightedCode
                  content={attachment.content}
                  filetype={filetypeFromPath(attachment.path) ?? "plaintext"}
                />
              </MessageFrame>
            </MessageFrameKindContext.Provider>
          ))}
        </box>
      )
    }
  }

  return (
    <box
      border={isAgent ? ["left"] : false}
      borderColor={isAgent ? AGENT_BORDER_COLOR : undefined}
      paddingLeft={isAgent ? 1 : 0}
      marginBottom={1}
      width="100%"
    >
      {message.role === "assistant"
        ? <markdown content={text} syntaxStyle={syntaxStyle} />
        : <text>{text}</text>}
    </box>
  )
}
