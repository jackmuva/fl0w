import { MouseButton, type MouseEvent } from "@opentui/core"
import { useState, type ReactNode } from "react"
import { theme } from "../../theme"

export const CHEVRON_FG = theme.muted
const HOVER_BG = theme.hover
const HOVER_CHEVRON_FG = theme.graphite

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
