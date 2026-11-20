import { describe, expect, test } from "bun:test"
import { MarkdownRenderable, RGBA, TextBufferRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { selectionColors } from "../../theme"
import { LinkableMarkdown } from "./LinkableMarkdown"

const descendants = (root: Renderable): Renderable[] => [root, ...root.getChildren().flatMap(descendants)]

describe("LinkableMarkdown selection", () => {
  test("colors selections and newly created markdown/code descendants after content changes", async () => {
    const setup = await testRender(<LinkableMarkdown content={"plain text\n\n> quoted words\n\n```\ncode words\n```"} />, {
      width: 60,
      height: 20,
    })
    try {
      await setup.renderOnce()
      const markdown = descendants(setup.renderer.root).find((node) => node instanceof MarkdownRenderable)
      expect(markdown).toBeDefined()
      const textNodes = () => descendants(markdown!).filter((node): node is TextBufferRenderable => node instanceof TextBufferRenderable)
      const checkColors = () => {
        expect(textNodes().length).toBeGreaterThanOrEqual(3)
        for (const node of textNodes()) {
          expect(node.selectionFg?.equals(RGBA.fromHex(selectionColors.selectionFg))).toBe(true)
          expect(node.selectionBg?.equals(RGBA.fromHex(selectionColors.selectionBg))).toBe(true)
        }
      }
      checkColors()
      markdown!.content += "\n\n```\nnew code\n```"
      await setup.renderOnce()
      checkColors()

      const code = textNodes().find((node) => node.plainText.includes("new code"))!
      await setup.mockMouse.drag(code.x, code.y, code.x + 4, code.y)
      await setup.renderOnce()
      expect(setup.renderer.getSelection()?.getSelectedText()).toContain("new")
      const selected = setup.captureSpans().lines[code.y]?.spans.find((span) => span.text.includes("new"))
      expect(selected?.fg.equals(RGBA.fromHex(selectionColors.selectionFg))).toBe(true)
      expect(selected?.bg.equals(RGBA.fromHex(selectionColors.selectionBg))).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
