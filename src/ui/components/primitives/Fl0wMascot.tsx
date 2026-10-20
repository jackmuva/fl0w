import { useEffect, useState } from "react"
import {
  FL0W_MASCOT_BLINK,
  FL0W_MASCOT_DANCE_FRAMES,
  FL0W_MASCOT_IDLE,
  mascotFrameToSpans,
} from "../../lib/fl0w-mascot"

const NOTE_LEFT_FG = "#f7768e"
const NOTE_RIGHT_FG = "#e0af68"
const STAGE_FG = "#565f89"
const STAGE_NODE_FG = "#9ece6a"
const DANCE_INTERVAL_MS = 170

type Fl0wMascotProps = {
  dancing?: boolean
}

// Flo, the lil workflow generator: idles (with the odd blink) above the
// input, and dances on his workflow-node stage while the agent is working.
export const Fl0wMascot = ({ dancing = false }: Fl0wMascotProps) => {
  const [frame, setFrame] = useState(0)
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (!dancing) return
    setFrame(0)
    const id = setInterval(() => {
      setFrame((current) => (current + 1) % FL0W_MASCOT_DANCE_FRAMES.length)
    }, DANCE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [dancing])

  useEffect(() => {
    if (dancing) return
    let hide: ReturnType<typeof setTimeout> | undefined
    const id = setInterval(() => {
      setBlinking(true)
      hide = setTimeout(() => setBlinking(false), 160)
    }, 2800)
    return () => {
      clearInterval(id)
      clearTimeout(hide)
    }
  }, [dancing])

  const sprite = dancing
    ? FL0W_MASCOT_DANCE_FRAMES[frame % FL0W_MASCOT_DANCE_FRAMES.length]!
    : blinking
      ? FL0W_MASCOT_BLINK
      : FL0W_MASCOT_IDLE
  const spanRows = mascotFrameToSpans(sprite)
  const bouncing = dancing && frame % 2 === 0

  return (
    <box flexDirection="row" alignItems="flex-end" flexShrink={0} height={7}>
      <text fg={NOTE_LEFT_FG} marginBottom={5} selectable={false}>
        {dancing && frame % 2 === 0 ? "♪ " : "  "}
      </text>
      <box flexDirection="column" alignItems="center" flexShrink={0}>
        {spanRows.map((spans, row) => (
          <text key={row} wrapMode="none" selectable={false}>
            {spans.map((span, index) => (
              <span key={index} fg={span.fg} bg={span.bg}>{span.text}</span>
            ))}
          </text>
        ))}
        <box height={bouncing ? 1 : 0} flexShrink={0} />
        <text fg={STAGE_FG} selectable={false}>
          <span fg={STAGE_NODE_FG}>●</span>{"───"}
          <span fg={STAGE_NODE_FG}>●</span>{"───"}
          <span fg={STAGE_NODE_FG}>●</span>
        </text>
      </box>
      <text fg={NOTE_RIGHT_FG} marginBottom={5} selectable={false}>
        {dancing && frame % 2 === 1 ? " ♫" : "  "}
      </text>
    </box>
  )
}
