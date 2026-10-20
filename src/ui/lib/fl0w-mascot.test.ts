import { describe, expect, test } from "bun:test"
import {
  FL0W_MASCOT_BLINK,
  FL0W_MASCOT_DANCE_FRAMES,
  FL0W_MASCOT_IDLE,
  FL0W_MASCOT_WIDTH,
  mascotFrameToSpans,
} from "./fl0w-mascot"

const ALL_FRAMES = [FL0W_MASCOT_IDLE, FL0W_MASCOT_BLINK, ...FL0W_MASCOT_DANCE_FRAMES]

describe("fl0w mascot frames", () => {
  test("every frame is a full rectangle of pixels", () => {
    for (const frame of ALL_FRAMES) {
      expect(frame.length).toBeGreaterThan(0)
      expect(frame.length % 2).toBe(0)
      for (const row of frame) expect(row.length).toBe(FL0W_MASCOT_WIDTH)
    }
  })

  test("dance frames actually move", () => {
    const unique = new Set(FL0W_MASCOT_DANCE_FRAMES.map((frame) => frame.join("\n")))
    expect(FL0W_MASCOT_DANCE_FRAMES.length).toBeGreaterThanOrEqual(4)
    expect(unique.size).toBe(FL0W_MASCOT_DANCE_FRAMES.length)
    for (const frame of FL0W_MASCOT_DANCE_FRAMES) expect(frame).not.toEqual(FL0W_MASCOT_IDLE)
  })

  test("blink only closes the eyes", () => {
    const changed = FL0W_MASCOT_IDLE.filter((row, index) => row !== FL0W_MASCOT_BLINK[index])
    expect(changed.length).toBe(1)
  })
})

describe("mascotFrameToSpans", () => {
  test("packs two pixel rows into one terminal row", () => {
    const rows = mascotFrameToSpans(FL0W_MASCOT_IDLE)
    expect(rows.length).toBe(FL0W_MASCOT_IDLE.length / 2)
    for (const spans of rows) {
      expect(spans.map((span) => span.text).join("").length).toBe(FL0W_MASCOT_WIDTH)
    }
  })

  test("uses half blocks so stacked pixels keep both colors", () => {
    // Antenna node (top) sits directly over the droplet tip (bottom).
    const [firstRow] = mascotFrameToSpans(FL0W_MASCOT_IDLE)
    const stacked = firstRow?.find((span) => span.bg)
    expect(stacked?.text).toContain("▀")
    expect(stacked?.fg).toBe("#e0af68")
    expect(stacked?.bg).toBe("#7dcfff")
  })
})
