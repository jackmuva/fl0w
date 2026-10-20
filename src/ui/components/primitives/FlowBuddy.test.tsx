import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, jest, test } from "bun:test"
import { act } from "react"
import { CREAM_FG, GREEN_FG } from "./MessageFrame"
import { FlowBuddy } from "./FlowBuddy"

const WIDTH = 80
const HEIGHT = 20
const OLIVE_FG = "#6e8b3d"

const idleRows = [
  "             ",
  "    ▄▄▄▄▄    ",
  "   ███████   ",
  "  ███◕█◕███  ",
  " ●─███◡███─● ",
  "    │   │    ",
  "    ●   ●    ",
]

const danceRows = [
  " ●─ ▄▄▄▄▄ ─● ",
  "   ███████   ",
  "  ███◕█◕███  ",
  "   ███◡███   ",
  "     │ │     ",
  "     ● ●     ",
  "             ",
]

const renderCorner = async (dancing: boolean, terminalWidth: number) => {
  const screen = await testRender(
    <box width={WIDTH} height={HEIGHT} flexDirection="column">
      <box width="100%" flexGrow={1} position="relative" overflow="hidden" flexDirection="column">
        <box width="75%">
          <text>MESSAGE_FRAME</text>
        </box>
        <FlowBuddy dancing={dancing} terminalWidth={terminalWidth} />
      </box>
      <text>CHAT_BAR</text>
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  await screen.renderOnce()
  return screen
}

const frameLines = (screen: TestRendererSetup) =>
  screen.captureCharFrame().replace(/\n$/, "").split("\n")

const spriteAboveChat = (lines: string[]) => {
  const chatIndex = lines.findIndex((line) => line.includes("CHAT_BAR"))
  return lines.slice(chatIndex - idleRows.length, chatIndex).map((line) => line.slice(-idleRows[0]!.length))
}

const spanColor = (screen: TestRendererSetup, text: string) => {
  for (const line of screen.captureSpans().lines) {
    const span = line.spans.find((item) => item.text.includes(text))
    if (span) return span.fg
  }
  return undefined
}

describe("FlowBuddy", () => {
  test("sits still in the gutter above the chat bar", async () => {
    const screen = await renderCorner(false, WIDTH)
    try {
      const lines = frameLines(screen)
      expect(spriteAboveChat(lines)).toEqual(idleRows)
      expect(lines.some((line) => line.includes("MESSAGE_FRAME"))).toBe(true)
      expect(spanColor(screen, "◕")?.equals(RGBA.fromHex(CREAM_FG))).toBe(true)
      expect(spanColor(screen, "▄▄▄▄▄")?.equals(RGBA.fromHex(GREEN_FG))).toBe(true)
      expect(spanColor(screen, "███████")?.equals(RGBA.fromHex(OLIVE_FG))).toBe(true)
      expect(spanColor(screen, "●   ●")?.equals(RGBA.fromHex(CREAM_FG))).toBe(true)

      const first = screen.captureCharFrame()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
      })
      await screen.renderOnce()
      expect(screen.captureCharFrame()).toBe(first)
    } finally {
      screen.renderer.destroy()
    }
  })

  test("hides when the right gutter is narrower than the sprite", async () => {
    const screen = await renderCorner(false, 60)
    try {
      const frame = screen.captureCharFrame()
      expect(frame).toContain("MESSAGE_FRAME")
      expect(frame).toContain("CHAT_BAR")
      expect(frame).not.toContain("◕")
    } finally {
      screen.renderer.destroy()
    }
  })

  test("bobs up with his arms raised while the app is working", async () => {
    jest.useFakeTimers()
    const screen = await renderCorner(true, WIDTH)
    try {
      expect(spriteAboveChat(frameLines(screen))).toEqual(idleRows)

      await act(() => {
        jest.advanceTimersByTime(320)
      })
      await screen.renderOnce()

      expect(spriteAboveChat(frameLines(screen))).toEqual(danceRows)
    } finally {
      screen.renderer.destroy()
      jest.useRealTimers()
    }
  })
})
