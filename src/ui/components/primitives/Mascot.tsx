import { useEffect, useState } from "react"
import { CREAM_FG } from "./MessageFrame"

type Cell = { ch: string; fg?: string; bg?: string }

const PIXEL_FG: Record<string, string> = {
  o: "#8a9a46",
  l: "#b4c27a",
  s: "#62702e",
  c: "#c9b896",
  h: CREAM_FG,
  d: "#1f2414",
}

// Two pixel rows per terminal row, drawn with half blocks.
const BODY = [
  "..oooooo..",
  ".ollooooo.",
  "olooooooos",
  "ooooooooos",
  "oohoooohos",
  "oodoooodos",
  "ocoooooocs",
  "ooodoodoss",
  ".oooddoss.",
  "..ssssss..",
]

const ARM_SIDE = 2
const BODY_WIDTH = BODY[0]!.length
const WIDTH = ARM_SIDE * 2 + BODY_WIDTH
const BODY_ROWS = BODY.length / 2
const HEIGHT = BODY_ROWS + 2
const ARM_ROW = 3
const LEG_COLS = [ARM_SIDE + 3, ARM_SIDE + 6]

type Pose = { squat: boolean; leftUp: boolean; rightUp: boolean }

const IDLE: Pose = { squat: false, leftUp: false, rightUp: false }
const DANCE: Pose[] = [
  IDLE,
  { squat: true, leftUp: true, rightUp: false },
  IDLE,
  { squat: true, leftUp: false, rightUp: true },
]

const drawPose = ({ squat, leftUp, rightUp }: Pose): Cell[][] => {
  const grid: Cell[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => ({ ch: " " })),
  )
  const top = squat ? 1 : 0

  for (let row = 0; row < BODY_ROWS; row++) {
    for (let col = 0; col < BODY_WIDTH; col++) {
      const upper = PIXEL_FG[BODY[row * 2]![col]!]
      const lower = PIXEL_FG[BODY[row * 2 + 1]![col]!]
      const cell = grid[top + row]![ARM_SIDE + col]!
      if (upper && lower) Object.assign(cell, upper === lower ? { ch: "█", fg: upper } : { ch: "▀", fg: upper, bg: lower })
      else if (upper) Object.assign(cell, { ch: "▀", fg: upper })
      else if (lower) Object.assign(cell, { ch: "▄", fg: lower })
    }
  }

  const arm = grid[top + ARM_ROW]!
  const shoulder = grid[top + ARM_ROW - 1]!
  arm[0] = { ch: leftUp ? "╰" : "●", fg: CREAM_FG }
  arm[1] = { ch: "─", fg: CREAM_FG }
  arm[WIDTH - 2] = { ch: "─", fg: CREAM_FG }
  arm[WIDTH - 1] = { ch: rightUp ? "╯" : "●", fg: CREAM_FG }
  if (leftUp) shoulder[0] = { ch: "●", fg: CREAM_FG }
  if (rightUp) shoulder[WIDTH - 1] = { ch: "●", fg: CREAM_FG }

  for (const col of LEG_COLS) {
    if (!squat) grid[HEIGHT - 2]![col] = { ch: "│", fg: CREAM_FG }
    grid[HEIGHT - 1]![col] = { ch: "●", fg: CREAM_FG }
  }
  return grid
}

const IDLE_GRID = drawPose(IDLE)
const DANCE_GRIDS = DANCE.map(drawPose)

type MascotProps = {
  working: boolean
}

export const Mascot = ({ working }: MascotProps) => {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!working) {
      setFrame(0)
      return
    }
    const id = setInterval(() => setFrame((current) => (current + 1) % DANCE_GRIDS.length), 220)
    return () => clearInterval(id)
  }, [working])

  const grid = working ? DANCE_GRIDS[frame]! : IDLE_GRID

  return (
    <box flexDirection="column" flexShrink={0} width={WIDTH} height={HEIGHT}>
      {grid.map((cells, row) => (
        <text key={row} selectable={false}>
          {cells.map((cell, col) => (
            <span key={col} fg={cell.fg} bg={cell.bg}>{cell.ch}</span>
          ))}
        </text>
      ))}
    </box>
  )
}
