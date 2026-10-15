import { RGBA, SyntaxStyle } from "@opentui/core"

export const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#ff9e64"), bold: true },
  string: { fg: RGBA.fromHex("#9ece6a") },
  comment: { fg: RGBA.fromHex("#565f89"), italic: true },
  number: { fg: RGBA.fromHex("#e0af68") },
  function: { fg: RGBA.fromHex("#e6d5b8") },
  type: { fg: RGBA.fromHex("#2ac3de") },
  default: { fg: RGBA.fromHex("#c0caf5") },
})
