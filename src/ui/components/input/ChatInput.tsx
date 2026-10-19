import type { KeyBinding, KeyEvent, TextareaRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { listWorkspaceFiles } from "../../lib/input-completion/at-files"
import { useInputCompletion } from "../../hooks/useInputCompletion"
import type { SlashCommandActions } from "../../lib/input-completion/slash-commands"
import type { CompletionState } from "../../../models/ui"

const chatKeyBindings: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", action: "submit" },
  { name: "kpenter", shift: true, action: "newline" },
  { name: "linefeed", action: "submit" },
  { name: "linefeed", shift: true, action: "newline" },
]

const MAX_INPUT_LINES = 8
const BOX_PADDING_X = 1

type ChatInputProps = {
  disabled?: boolean
  placeholder?: string
  allowEmptySubmit?: boolean
  slashCommandHandlers: SlashCommandActions
  onCompletionChange?: (completion: CompletionState) => void
  onSubmit: (text: string) => void | Promise<void>
}

export const ChatInput = ({
  disabled = false,
  placeholder = "What would you like to do",
  allowEmptySubmit = false,
  slashCommandHandlers,
  onCompletionChange,
  onSubmit,
}: ChatInputProps) => {
  const textareaRef = useRef<TextareaRenderable>(null)
  const { width: terminalWidth } = useTerminalDimensions()
  const {
    completion,
    syncCompletion,
    handleKeyDown: handleCompletionKeyDown,
    handleSubmitAttempt,
    clearInput,
  } = useInputCompletion({ textareaRef, disabled, slashCommandActions: slashCommandHandlers })

  const [lineCount, setLineCount] = useState(1)

  const syncHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const lines = textarea.editorView.getTotalVirtualLineCount()
    setLineCount(Math.min(Math.max(lines, 1), MAX_INPUT_LINES))
  }

  const handleContentChange = () => {
    syncHeight()
    syncCompletion()
    // Wrapped line count can lag one layout pass behind edits.
    queueMicrotask(syncHeight)
  }

  useEffect(() => {
    void listWorkspaceFiles()
  }, [])

  useEffect(() => {
    syncHeight()
  }, [terminalWidth])

  useEffect(() => {
    onCompletionChange?.(completion)
  }, [completion, onCompletionChange])

  const handleSubmit = async () => {
    if (disabled) return
    if (!handleSubmitAttempt()) return

    const text = textareaRef.current?.plainText.trim() ?? ""
    if (!text && !allowEmptySubmit) return

    textareaRef.current?.clear()
    syncHeight()
    await onSubmit(text)
  }

  const handleKeyDown = (event: KeyEvent) => {
    if (event.name === "c" && event.ctrl) {
      event.preventDefault()
      clearInput()
      syncHeight()
      return
    }

    handleCompletionKeyDown(event)
  }

  return (
    <box backgroundColor={"#1e1e2e"}
      paddingLeft={BOX_PADDING_X}
      paddingRight={BOX_PADDING_X}
      paddingTop={1}
      paddingBottom={1}
      flexShrink={0} >
      <textarea
        ref={textareaRef}
        marginY={0}
        width="100%"
        maxWidth="100%"
        height={lineCount}
        flexShrink={0}
        wrapMode="word"
        placeholder={placeholder}
        keyBindings={chatKeyBindings}
        onSubmit={handleSubmit}
        onContentChange={handleContentChange}
        onCursorChange={handleContentChange}
        onKeyDown={handleKeyDown}
        focused={!disabled}
      />
    </box>
  )
}
