import { useEffect, useState } from "react"
import { theme } from "../../theme"

const WIDTH = 28
const TICK_MS = 110

// The page-curl you never see on e-ink: a quiet reading-progress bar that
// fills slowly, then clears and starts again — the way an e-reader marks a
// place in the book. Mounted only while the agent loop is working.
export const ReadingProgress = () => {
  const [filled, setFilled] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setFilled((current) => (current + 1) % (WIDTH + 1))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <box flexDirection="column" flexShrink={0} width={WIDTH} height={1}>
      <text fg={theme.edge} selectable={false} wrapMode="none">
        <span fg={theme.moss}>{"━".repeat(filled)}</span>
        {"─".repeat(WIDTH - filled)}
      </text>
    </box>
  )
}
