import { MouseButton, TextBufferRenderable, type MouseEvent, type Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useRef } from "react"
import { openBrowser } from "../../../services/service-utils"
import { syntaxStyle } from "../../lib/syntax-style"
import { selectionColors, theme } from "../../theme"

// Markdown creates and reconciles its own text/code descendants. Walk the live tree
// after its render, since updates can add descendants without calling renderNode.
// This also preserves default block coalescing and link handling. In 0.5.12 the
// default table has no public selection-color setters, so it keeps its own colors.
// A WeakSet avoids reapplying the colors on every frame without retaining nodes.
const styledForSelection = new WeakSet<TextBufferRenderable>()
function styleMarkdownSelection(this: Renderable) {
  const pending = [this]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node instanceof TextBufferRenderable && !styledForSelection.has(node)) {
      node.selectionFg = selectionColors.selectionFg
      node.selectionBg = selectionColors.selectionBg
      styledForSelection.add(node)
    }
    pending.push(...node.getChildren())
  }
}

// Model output is untrusted; only hand web links to the OS opener, never file:// or app schemes.
const isOpenableUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url)
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Markdown whose links open on a plain click. The app captures the mouse, so the terminal's own OSC 8 handling
 * needs a modifier key; this looks up the link under the cell instead and opens it directly.
 */
export const LinkableMarkdown = ({ content }: { content: string }) => {
  const renderer = useRenderer()
  const overLink = useRef(false)

  const linkAt = (event: MouseEvent): string | null => {
    const url = renderer.getLinkAt(event.x, event.y)
    return url && isOpenableUrl(url) ? url : null
  }

  const setOverLink = (next: boolean) => {
    if (overLink.current === next) return
    overLink.current = next
    renderer.setMousePointer(next ? "pointer" : "default")
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== MouseButton.LEFT) return
    const url = linkAt(event)
    if (!url) return
    // Only swallow the press when it lands on a link, so text selection elsewhere still starts normally.
    event.preventDefault()
    event.stopPropagation()
    openBrowser(url)
  }

  return (
    <box
      width="100%"
      onMouseDown={handleMouseDown}
      onMouseMove={(event: MouseEvent) => setOverLink(linkAt(event) !== null)}
      onMouseOut={() => setOverLink(false)}
    >
      <markdown
        content={content}
        syntaxStyle={syntaxStyle}
        fg={theme.ink}
        renderAfter={styleMarkdownSelection}
      />
    </box>
  )
}
