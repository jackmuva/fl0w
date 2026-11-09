import type { KeyBinding, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import { AGENT_BORDER_COLOR } from "../primitives/MessageFrame"

const DIALOG_WIDTH = 64
const DIALOG_PADDING = 2
const DIALOG_BORDER = 2
const PROMPT_WIDTH = 2
const MAX_INPUT_LINES = 6
const ACCENT_FG = "#e6d5b8"
const TEXT_FG = "#c0caf5"
const MUTED_FG = "#565f89"
const HELP_TEXT = "Describe what should vary each run (e.g. \"customer email, date range\" and additional instructions"
const HINT_TEXT = "Enter to generate · Shift+Enter for newline · Esc to cancel"

const inputKeyBindings: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", action: "submit" },
  { name: "kpenter", shift: true, action: "newline" },
  { name: "linefeed", action: "submit" },
  { name: "linefeed", shift: true, action: "newline" },
]

type WorkflowInputsDialogProps = {
  sessionTitle: string
  onConfirm: (inputSpec: string) => void
  onDismiss: () => void
  terminalWidth: number
  terminalHeight: number
}

export const WorkflowInputsDialog = ({
  sessionTitle,
  onConfirm,
  onDismiss,
  terminalWidth,
  terminalHeight,
}: WorkflowInputsDialogProps) => {
  const textareaRef = useRef<TextareaRenderable>(null)
  const [lineCount, setLineCount] = useState(1)

  useKeyboard((key) => {
    if (key.name === "escape") onDismiss()
  })

  const syncHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const lines = textarea.editorView.getTotalVirtualLineCount()
    setLineCount(Math.min(Math.max(lines, 1), MAX_INPUT_LINES))
  }

  const handleContentChange = () => {
    syncHeight()
    queueMicrotask(syncHeight)
  }

  useEffect(() => {
    syncHeight()
  }, [terminalWidth])

  const handleSubmit = () => {
    onConfirm(textareaRef.current?.plainText.trim() ?? "")
  }

  const dialogWidth = Math.min(DIALOG_WIDTH, Math.max(24, terminalWidth - 4))
  const innerWidth = dialogWidth - DIALOG_BORDER - DIALOG_PADDING
  const subtitle = `From: ${sessionTitle}`
  const wrapped = (value: string) => Math.max(1, Math.ceil(value.length / innerWidth))
  // title + subtitle + help + blank + input + blank + hint
  const contentLines = 1 + wrapped(subtitle) + wrapped(HELP_TEXT) + 1 + lineCount + 1 + wrapped(HINT_TEXT)
  const dialogHeight = contentLines + DIALOG_PADDING + DIALOG_BORDER
  const top = Math.max(1, Math.floor((terminalHeight - dialogHeight) / 2))
  const left = Math.max(1, Math.floor((terminalWidth - dialogWidth) / 2))

  return (
    <>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={5}
        backgroundColor="#000000"
        opacity={0.45}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={dialogWidth}
        height={dialogHeight}
        zIndex={10}
        border={true}
        borderColor={AGENT_BORDER_COLOR}
        backgroundColor="#1a1b26"
        flexDirection="column"
        padding={1}
      >
        <text fg={AGENT_BORDER_COLOR} flexShrink={0}>Workflow inputs</text>
        <text fg={MUTED_FG} flexShrink={0}>{subtitle}</text>
        <text fg={TEXT_FG} flexShrink={0}>{HELP_TEXT}</text>
        <box flexDirection="row" marginTop={1} width="100%" height={lineCount} flexShrink={0}>
          <text fg={ACCENT_FG} width={PROMPT_WIDTH} flexShrink={0}>{"› "}</text>
          <textarea
            ref={textareaRef}
            flexGrow={1}
            height={lineCount}
            wrapMode="word"
            placeholder="No inputs"
            keyBindings={inputKeyBindings}
            onSubmit={handleSubmit}
            onContentChange={handleContentChange}
            onCursorChange={handleContentChange}
            focused={true}
          />
        </box>
        <text fg={MUTED_FG} marginTop={1} flexShrink={0}>{HINT_TEXT}</text>
      </box>
    </>
  )
}
