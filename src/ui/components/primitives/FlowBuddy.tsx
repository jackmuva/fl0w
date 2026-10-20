import { useEffect, useState } from "react"
import { CREAM_FG, GREEN_FG } from "./MessageFrame"

const SPRITE_WIDTH = 13
const SPRITE_HEIGHT = 7
// Message frames use 75% of the width. Hide the buddy until the right gutter clears him.
const MIN_TERMINAL_WIDTH = 64
const DANCE_INTERVAL_MS = 320
// Darker olive than the theme green so cream eyes and the smile stay readable.
const OLIVE_FG = "#6e8b3d"

type Segment = { fg: string; text: string }
type Sprite = Segment[][]

const olive = (text: string): Segment => ({ fg: OLIVE_FG, text })
const highlight = (text: string): Segment => ({ fg: GREEN_FG, text })
const cream = (text: string): Segment => ({ fg: CREAM_FG, text })

// Idle sits on the bottom row. The dance pose shifts him up a row, arms raised, feet tucked.
const idleSprite: Sprite = [
  [cream("             ")],
  [highlight("    ▄▄▄▄▄    ")],
  [olive("   ▄█████▄   ")],
  [olive("  ███"), cream("◕ ◕"), olive("███  ")],
  [cream(" ●─"), olive("▀██"), cream("◡"), olive("██▀"), cream("─● ")],
  [cream("    │   │    ")],
  [cream("    ●   ●    ")],
]

const danceSprite: Sprite = [
  [cream(" ●─ "), highlight("▄▄▄▄▄"), cream(" ─● ")],
  [olive("   ▄█████▄   ")],
  [olive("  ███"), cream("◕ ◕"), olive("███  ")],
  [olive("   ▀██"), cream("◡"), olive("██▀   ")],
  [cream("     │ │     ")],
  [cream("     ● ●     ")],
  [cream("             ")],
]

const sprites: Sprite[] = [idleSprite, danceSprite]

type FlowBuddyProps = {
  dancing: boolean
  terminalWidth: number
}

export const FlowBuddy = ({ dancing, terminalWidth }: FlowBuddyProps) => {
  const [frame, setFrame] = useState(0)
  const hidden = terminalWidth < MIN_TERMINAL_WIDTH

  useEffect(() => {
    if (!dancing || hidden) return

    const id = setInterval(() => {
      setFrame((current) => (current + 1) % sprites.length)
    }, DANCE_INTERVAL_MS)

    return () => {
      clearInterval(id)
      setFrame(0)
    }
  }, [dancing, hidden])

  if (hidden) return null

  const sprite = (dancing ? sprites[frame] : sprites[0]) ?? idleSprite

  return (
    <box
      position="absolute"
      right={0}
      bottom={0}
      width={SPRITE_WIDTH}
      height={SPRITE_HEIGHT}
      flexDirection="column"
      flexShrink={0}
      zIndex={2}
    >
      {sprite.map((line, row) => (
        <box key={row} width={SPRITE_WIDTH} height={1} flexShrink={0}>
          <text wrapMode="none" selectable={false}>
            {line.map((segment, index) => (
              <span key={index} fg={segment.fg}>{segment.text}</span>
            ))}
          </text>
        </box>
      ))}
    </box>
  )
}
