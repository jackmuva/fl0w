import { MouseButton, type MouseEvent } from "@opentui/core"
import { useState, type ReactNode } from "react"

export const CHEVRON_FG = "#7aa2f7"
const HOVER_BG = "#292e42"
const HOVER_CHEVRON_FG = "#e6d5b8"

type ExpandableRowProps = {
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  chevronFg?: string
}

// A clickable line led by a ▸/▾ chevron that lights up on hover, so expandable rows read as controls.
export const ExpandableRow = ({ expanded, onToggle, children, chevronFg = CHEVRON_FG }: ExpandableRowProps) => {
  const [hovered, setHovered] = useState(false)

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT) return
    event.preventDefault()
    onToggle()
  }

  return (
    <box
      flexDirection="row"
      width="100%"
      backgroundColor={hovered ? HOVER_BG : "transparent"}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={handleMouseDown}
    >
      <text fg={hovered ? HOVER_CHEVRON_FG : chevronFg} selectable={false} flexShrink={0}>
        {expanded ? "▾ " : "▸ "}
      </text>
      <box flexGrow={1} flexShrink={1}>{children}</box>
    </box>
  )
}
