import { useKeyboard } from "@opentui/react"
const DIALOG_WIDTH = 52
const DIALOG_PADDING = 2
const DIALOG_BORDER = 2
const MUTED_FG = "#565f89"
const TEXT_FG = "#c0caf5"
const WARNING_FG = "#f7768e"

type DeleteConfirmationDialogProps = {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  terminalWidth: number
  terminalHeight: number
}

export const DeleteConfirmationDialog = ({
  title,
  message,
  onConfirm,
  onCancel,
  terminalWidth,
  terminalHeight,
}: DeleteConfirmationDialogProps) => {
  useKeyboard((key) => {
    if (key.name === "return" || key.name === "kpenter") {
      key.stopPropagation()
      onConfirm()
      return
    }
    if (key.name === "escape") {
      key.stopPropagation()
      onCancel()
      return
    }
    key.stopPropagation()
  })

  const dialogWidth = Math.min(DIALOG_WIDTH, Math.max(28, terminalWidth - 4))
  const innerWidth = dialogWidth - DIALOG_BORDER - DIALOG_PADDING
  const messageLines = Math.max(1, Math.ceil(message.length / innerWidth))
  const chromeLines = 1 + 1 + messageLines + DIALOG_PADDING + DIALOG_BORDER
  const dialogHeight = chromeLines
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
        zIndex={15}
        backgroundColor="#000000"
        opacity={0.55}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={dialogWidth}
        height={dialogHeight}
        zIndex={20}
        border={true}
        borderColor={WARNING_FG}
        backgroundColor="#1a1b26"
        flexDirection="column"
        padding={1}
      >
        <text fg={WARNING_FG} flexShrink={0}>{title}</text>
        <text fg={TEXT_FG} flexShrink={0} wrapMode="word">{message}</text>
        <text fg={MUTED_FG} flexShrink={0}>Enter to delete · Esc to cancel</text>
      </box>
    </>
  )
}
