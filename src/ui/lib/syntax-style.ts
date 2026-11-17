import { RGBA, SyntaxStyle } from "@opentui/core"
import { theme } from "../theme"

const fg = (hex: string) => RGBA.fromHex(hex)

// E-ink code: weight and greys carry structure; moss strings and clay numbers add a touch of color.
export const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: fg(theme.ink), bold: true },
  string: { fg: fg(theme.moss) },
  comment: { fg: fg(theme.muted), italic: true },
  number: { fg: fg(theme.clay) },
  function: { fg: fg(theme.graphite) },
  type: { fg: fg(theme.inkSoft), italic: true },
  default: { fg: fg(theme.ink) },
  "markup.heading": { fg: fg(theme.ink), bold: true },
  "markup.strong": { fg: fg(theme.ink), bold: true },
  "markup.italic": { fg: fg(theme.inkSoft), italic: true },
  "markup.quote": { fg: fg(theme.muted), italic: true },
  "markup.list": { fg: fg(theme.muted) },
  "markup.raw": { fg: fg(theme.graphite) },
  "markup.link": { fg: fg(theme.moss), underline: true },
  "markup.link.label": { fg: fg(theme.moss), underline: true },
  "markup.link.url": { fg: fg(theme.muted), underline: true },
  conceal: { fg: fg(theme.faint) },
  "punctuation.special": { fg: fg(theme.faint) },
})
