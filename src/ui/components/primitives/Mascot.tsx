import { useEffect, useState } from "react"
import { CREAM_FG } from "./MessageFrame"

type Cell = { ch: string; fg?: string; bg?: string }

const LIMB_FG = "#8a9a46"

const PIXEL_FG: Record<string, string> = {
  o: CREAM_FG,
  d: "#1f2414",
  h: "#ffffff",
}

// Two pixel rows per terminal row, drawn with half blocks.
const BODY = [
  "..oooooo..",
  ".oooooooo.",
  "oooooooooo",
  "oohdoohdoo",
  "ooddooddoo",
  "ooddooddoo",
  ".oooooooo.",
  "..oooooo..",
]

const ARM_SIDE = 2
const SWAY = 1
const BODY_WIDTH = BODY[0]!.length
const SPRITE_WIDTH = ARM_SIDE * 2 + BODY_WIDTH
const WIDTH = SPRITE_WIDTH + SWAY * 2
const BODY_ROWS = BODY.length / 2
const HEIGHT = BODY_ROWS + 2
const ARM_ROW = 2
const LEG_COLS = [ARM_SIDE + 3, ARM_SIDE + 6]

type Pose = { squat: boolean; leftUp: boolean; rightUp: boolean; shift?: number; armsIn?: boolean }

const IDLE: Pose = { squat: true, leftUp: false, rightUp: false }
const STAND: Pose = { squat: false, leftUp: false, rightUp: false }
const BOUNCE: Pose[] = [
  STAND,
  { squat: true, leftUp: true, rightUp: false },
  STAND,
  { squat: true, leftUp: false, rightUp: true },
]
const SWAY_MOVE: Pose[] = [
  { ...IDLE, shift: -1 },
  { ...IDLE, armsIn: true },
  { ...IDLE, shift: 1 },
  { ...IDLE, armsIn: true },
]

const drawPose = ({ squat, leftUp, rightUp, shift = 0, armsIn = false }: Pose): Cell[][] => {
  const grid: Cell[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => ({ ch: " " })),
  )
  const top = squat ? 1 : 0
  const left = SWAY + shift

  for (let row = 0; row < BODY_ROWS; row++) {
    for (let col = 0; col < BODY_WIDTH; col++) {
      const upper = PIXEL_FG[BODY[row * 2]![col]!]
      const lower = PIXEL_FG[BODY[row * 2 + 1]![col]!]
      const cell = grid[top + row]![left + ARM_SIDE + col]!
      if (upper && lower) Object.assign(cell, upper === lower ? { ch: "█", fg: upper } : { ch: "▀", fg: upper, bg: lower })
      else if (upper) Object.assign(cell, { ch: "▀", fg: upper })
      else if (lower) Object.assign(cell, { ch: "▄", fg: lower })
    }
  }

  const arm = grid[top + ARM_ROW]!
  const shoulder = grid[top + ARM_ROW - 1]!
  const right = left + SPRITE_WIDTH - 1
  if (armsIn) {
    arm[left + 1] = { ch: "●", fg: LIMB_FG }
    arm[right - 1] = { ch: "●", fg: LIMB_FG }
  } else {
    arm[left] = { ch: leftUp ? "╰" : "●", fg: LIMB_FG }
    arm[left + 1] = { ch: "─", fg: LIMB_FG }
    arm[right - 1] = { ch: "─", fg: LIMB_FG }
    arm[right] = { ch: rightUp ? "╯" : "●", fg: LIMB_FG }
    if (leftUp) shoulder[left] = { ch: "●", fg: LIMB_FG }
    if (rightUp) shoulder[right] = { ch: "●", fg: LIMB_FG }
  }

  for (const col of LEG_COLS) {
    if (!squat) grid[HEIGHT - 2]![left + col] = { ch: "│", fg: LIMB_FG }
    grid[HEIGHT - 1]![left + col] = { ch: "●", fg: LIMB_FG }
  }
  return grid
}

const IDLE_GRID = drawPose(IDLE)
const MOVES = [BOUNCE, SWAY_MOVE].map((move) => move.map(drawPose))

type MascotProps = {
  working: boolean
}

export const Mascot = ({ working }: MascotProps) => {
  const [frame, setFrame] = useState(0)
  const [move, setMove] = useState(0)

  useEffect(() => {
    if (!working) {
      setFrame(0)
      return
    }
    const id = setInterval(() => setFrame((current) => (current + 1) % MOVES[move]!.length), 220)
    return () => clearInterval(id)
  }, [working, move])

  // Every 3s, coin-flip whether to switch dance moves.
  useEffect(() => {
    if (!working) {
      setMove(0)
      return
    }
    const id = setInterval(() => {
      if (Math.random() < 0.5) setMove((current) => (current + 1) % MOVES.length)
    }, 3000)
    return () => clearInterval(id)
  }, [working])

  const grid = working ? MOVES[move]![frame]! : IDLE_GRID

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
