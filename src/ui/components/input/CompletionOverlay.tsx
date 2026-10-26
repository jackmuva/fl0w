import type { SelectOption } from "@opentui/core"
import type { CompletionItem, CompletionKind } from "../../../models/ui"
import { AGENT_BORDER_COLOR } from "../primitives/MessageFrame"

const MAX_VISIBLE_ITEMS = 6
const DIALOG_WIDTH = 56
const HEADER_LINES = 4
const DIALOG_PADDING = 2

type CompletionOverlayDialogProps = {
  kind: CompletionKind
  items: CompletionItem[]
  selectedIndex: number
  terminalWidth: number
  terminalHeight: number
}

const kindTitle = (kind: CompletionKind) =>
  kind === "at" ? "Attach file" : "Slash command"

export const CompletionOverlayDialog = ({
  kind,
  items,
  selectedIndex,
  terminalWidth,
  terminalHeight,
}: CompletionOverlayDialogProps) => {
  const options: SelectOption[] = items.map((item) => ({
    name: item.label,
    description: item.description ?? "",
    value: item.id,
  }))

  const linesPerItem = 2
  const listHeight = Math.min(
    MAX_VISIBLE_ITEMS * linesPerItem,
    Math.max(linesPerItem, options.length * linesPerItem),
  )
  const dialogHeight = listHeight + HEADER_LINES + DIALOG_PADDING
  const dialogWidth = Math.min(DIALOG_WIDTH, Math.max(24, terminalWidth - 4))
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
        <text fg={AGENT_BORDER_COLOR}>{kindTitle(kind)}</text>
        <text fg="#565f89">↑/↓ to navigate · Tab/Enter to accept · Esc to dismiss</text>
        <select
          options={options}
          selectedIndex={selectedIndex}
          showDescription={true}
          showSelectionIndicator={true}
          height={listHeight}
          width="100%"
          focused={false}
        />
      </box>
    </>
  )
}
