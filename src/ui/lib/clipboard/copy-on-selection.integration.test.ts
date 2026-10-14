import { describe, expect, test } from "bun:test"
import { TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { copySelectedText, disposeAppClipboard, initAppClipboard } from "./app-clipboard"

describe("copy on selection (integration)", () => {
  test("selection after drag copies text to clipboard service", async () => {
    const setup = await createTestRenderer({ width: 40, height: 6 })

    try {
      initAppClipboard(setup.renderer)
      const text = new TextRenderable(setup.renderer, {
        content: "select this line",
        width: 16,
      })
      setup.renderer.root.add(text)
      await setup.renderOnce()

      await setup.mockMouse.drag(text.x, text.y, text.x + 6, text.y)

      const selected = setup.renderer.getSelection()?.getSelectedText() ?? ""
      expect(selected.trim()).toBe("select")

      const copied = await copySelectedText(selected.trim())
      expect(copied).toBe(true)
    } finally {
      await disposeAppClipboard()
      setup.renderer.destroy()
    }
  })
})
