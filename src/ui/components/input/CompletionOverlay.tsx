import type { SelectOption } from "@opentui/core"
import type { CompletionItem, CompletionKind } from "../../../models/ui"
import { selectColors, theme } from "../../theme"

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
        backgroundColor={theme.shade}
        opacity={0.18}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={dialogWidth}
        height={dialogHeight}
        zIndex={10}
        backgroundColor={theme.paperRaised}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <box flexShrink={0} width="100%" border={["bottom"]} borderColor={theme.edge}>
          <text fg={theme.ink}><strong>{kindTitle(kind)}</strong></text>
        </box>
        <text fg={theme.muted}>↑/↓ to navigate · Tab/Enter to accept · Esc to dismiss</text>
        <select
          {...selectColors}
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
