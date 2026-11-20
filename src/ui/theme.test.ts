import { describe, expect, test } from "bun:test"
import { isDarkColor, selectColors, textOnBg, theme } from "./theme"

describe("isDarkColor", () => {
  test("dark palette colors read as dark", () => {
    expect(isDarkColor(theme.shade)).toBe(true) // #2a2a28
    expect(isDarkColor(theme.ink)).toBe(true) // #1f2a24
    expect(isDarkColor(theme.highlight)).toBe(true)
    expect(isDarkColor("#000000")).toBe(true)
  })

  test("light palette colors read as light", () => {
    expect(isDarkColor(theme.paper)).toBe(false) // #efede6
    expect(isDarkColor(theme.hover)).toBe(false) // #e0ded6
    expect(isDarkColor("#FFFFFF")).toBe(false)
  })
})

describe("textOnBg", () => {
  test("returns white on dark backgrounds", () => {
    expect(textOnBg(theme.shade, theme.ink)).toBe("#FFFFFF")
    expect(textOnBg(theme.highlight, theme.ink)).toBe("#FFFFFF")
    expect(textOnBg("#000000", theme.muted)).toBe("#FFFFFF")
  })

  test("keeps the given fg on light backgrounds", () => {
    expect(textOnBg(theme.hover, theme.ink)).toBe(theme.ink)
    expect(textOnBg(theme.paper, theme.muted)).toBe(theme.muted)
  })
})

describe("selectColors", () => {
  test("selected text contrasts with the selected background", () => {
    expect(selectColors.selectedBackgroundColor).toBe(theme.highlight)
    expect(selectColors.selectedTextColor).toBe(textOnBg(theme.highlight, theme.ink))
    expect(selectColors.selectedDescriptionColor).toBe(textOnBg(theme.highlight, theme.inkSoft))
    expect(selectColors.selectedTextColor).toBe("#FFFFFF")
    expect(selectColors.selectedDescriptionColor).toBe("#FFFFFF")
  })

  test("selected background has at least 4.5:1 contrast with white", () => {
    const rgb = theme.highlight.match(/[\da-f]{2}/gi)!.map((channel) => {
      const value = parseInt(channel, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  test("unselected colors remain unchanged", () => {
    expect(selectColors.backgroundColor).toBe(theme.paperRaised)
    expect(selectColors.focusedBackgroundColor).toBe(theme.paperRaised)
    expect(selectColors.textColor).toBe(theme.ink)
    expect(selectColors.focusedTextColor).toBe(theme.ink)
    expect(selectColors.descriptionColor).toBe(theme.muted)
  })
})
