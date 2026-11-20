import { useEffect, useState } from "react"
import { theme } from "../../theme"

const SLOTS = 20
const BLOCK = "█"
const HOLD_FULL_MS = 1500

// Old-console pacing: mostly slow steady steps, with the occasional stall
// where the bar seems stuck before lurching forward again.
const nextDelay = () => {
  const roll = Math.random()
  if (roll < 0.12) return 1400 + Math.random() * 1200 // stall
  if (roll < 0.3) return 550 + Math.random() * 150 // quick burst
  return 750 + Math.random() * 350 // steady crawl
}

// A retro video-game style loading bar: chunky blocks fill one at a time at an
// uneven, deliberate pace, hold when full, then clear and restart.
// Mounted only while the agent loop is working.
export const LoadingBar = ({ label = "Loading…" }: {label: string}) => {
  const [filled, setFilled] = useState(0)

  useEffect(() => {
    const delay = filled >= SLOTS ? HOLD_FULL_MS : nextDelay()
    const id = setTimeout(() => {
      setFilled((current) => (current >= SLOTS ? 0 : current + 1))
    }, delay)
    return () => clearTimeout(id)
  }, [filled])

  const cells = Array.from({ length: SLOTS }, (_, index) => (
    <span key={index} fg={theme.moss}>
      {index < filled ? BLOCK : " "}
    </span>
  ))

  // The outline is drawn with one-eighth blocks that sit on the cell edge
  // nearest the fill ("▁" bottom, "▔" top, "▕" right, "▏" left), so it hugs
  // the bar instead of leaving a half-cell gap like box-drawing lines do.
  return (
    <box flexDirection="row" flexShrink={0} alignItems="center">
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.muted} selectable={false} wrapMode="none">
          {" " + "▁".repeat(SLOTS) + " "}
        </text>
        <text fg={theme.muted} selectable={false} wrapMode="none">
          {"▕"}{cells}{"▏"}
        </text>
        <text fg={theme.muted} selectable={false} wrapMode="none">
          {" " + "▔".repeat(SLOTS) + " "}
        </text>
      </box>
      <text fg={theme.inkSoft} selectable={false}>{` ${label}`}</text>
    </box>
  )
}
