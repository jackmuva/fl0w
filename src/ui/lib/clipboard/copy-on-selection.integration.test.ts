import { describe, expect, test } from "bun:test"
import { RGBA, TextareaRenderable, TextRenderable, type CapturedFrame, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { act, createElement } from "react"
import { DefaultToolView } from "../../components/primitives/DefaultToolView"
import { CodeToolView } from "../../components/primitives/CodeToolView"
import { DiffToolView } from "../../components/primitives/DiffToolView"
import { WorkflowInputsDialog } from "../../components/dialogs/WorkflowInputsDialog"
import { SessionSelectionDialog } from "../../components/dialogs/SessionSelectionDialog"
import { selectionColors, selectColors, theme } from "../../theme"
import { copySelectedText, disposeAppClipboard, initAppClipboard } from "./app-clipboard"

const descendants = (root: Renderable): Renderable[] => [root, ...root.getChildren().flatMap(descendants)]

// Fixtures use ASCII, so character indices and terminal cell columns coincide.
const locate = (frame: string, text: string) => {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: lines[y]!.indexOf(text), y }
}

const cellColors = (frame: CapturedFrame, x: number, y: number) => {
  let column = 0
  for (const span of frame.lines[y]!.spans) {
    if (x < column + span.width) return { fg: span.fg.toInts(), bg: span.bg.toInts() }
    column += span.width
  }
  throw new Error(`No cell at ${x},${y}`)
}

const colors = (fg: string, bg: string) => ({ fg: RGBA.fromHex(fg).toInts(), bg: RGBA.fromHex(bg).toInts() })

const assertSelection = async (setup: Awaited<ReturnType<typeof testRender>>, text: string) => {
  await act(async () => { await setup.renderOnce() })
  const { x, y } = locate(setup.captureCharFrame(), text)
  const before = setup.captureSpans()
  const adjacent = cellColors(before, x + 6, y)
  await act(async () => {
    await setup.mockMouse.drag(x, y, x + 5, y)
    await setup.renderOnce()
  })
  expect(setup.renderer.getSelection()?.getSelectedText()).toBe("select")
  const after = setup.captureSpans()
  for (let i = 0; i < 6; i++) {
    expect(cellColors(after, x + i, y)).toEqual(colors(selectionColors.selectionFg, selectionColors.selectionBg))
  }
  expect(cellColors(after, x + 6, y)).toEqual(adjacent)
  expect(adjacent).not.toEqual(colors(selectionColors.selectionFg, selectionColors.selectionBg))
}

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

  test("dragging over tool output paints the selection white on the shared highlight", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(
        createElement(DefaultToolView, { toolName: "example", text: "select this line" }),
        { width: 40, height: 6 },
      )
    })

    try {
      await act(async () => { await setup.renderOnce() })
      const lines = setup.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes("select this line"))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = lines[y]!.indexOf("select this line")

      await act(async () => {
        await setup.mockMouse.drag(x, y, x + 6, y)
        await setup.renderOnce()
      })

      expect(setup.renderer.getSelection()?.getSelectedText().trim()).toBe("select")
      const selectedSpan = setup.captureSpans().lines[y]!.spans.find((span) => span.text.includes("select"))
      expect(selectedSpan).toBeDefined()
      expect(selectedSpan!.fg.toInts()).toEqual(RGBA.fromHex("#ffffff").toInts())
      expect(selectedSpan!.bg.toInts()).toEqual(RGBA.fromHex(theme.highlight).toInts())
    } finally {
      await act(async () => { setup.renderer.destroy() })
    }
  })

  test("textarea selection uses shared colors without recoloring adjacent input", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(createElement(WorkflowInputsDialog, {
        sessionTitle: "Example", onConfirm: () => {}, onDismiss: () => {}, terminalWidth: 80, terminalHeight: 24,
      }), { width: 80, height: 24 })
    })
    try {
      const textarea = descendants(setup.renderer.root).find((node): node is TextareaRenderable => node instanceof TextareaRenderable)
      expect(textarea).toBeDefined()
      await act(async () => { textarea!.setText("select this input"); await setup.renderOnce() })
      await assertSelection(setup, "select this input")
    } finally {
      await act(async () => { setup.renderer.destroy() })
    }
  })

  test("normal code selection uses shared colors without recoloring adjacent code", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(createElement(CodeToolView, {
        toolName: "read", text: "", content: "select this code", filetype: "plaintext",
      }), { width: 60, height: 10 })
    })
    try {
      await assertSelection(setup, "select this code")
    } finally {
      await act(async () => { setup.renderer.destroy() })
    }
  })

  test("normal diff selection uses shared colors without recoloring adjacent added text", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(createElement(DiffToolView, {
        toolName: "edit", text: "", diff: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old line\n+select this diff\n", filetype: "plaintext",
      }), { width: 60, height: 10 })
    })
    try {
      await assertSelection(setup, "select this diff")
    } finally {
      await act(async () => { setup.renderer.destroy() })
    }
  })

  test("selected select-menu option and description contrast with the unselected option", async () => {
    const record = (id: string, title: string) => ({
      id, title, workspacePath: "/test", models: null, capabilities: null,
      createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
    })
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(createElement(SessionSelectionDialog, {
        sessions: [record("one", "First option"), record("two", "Second option")],
        onSelect: () => {}, onDismiss: () => {}, terminalWidth: 80, terminalHeight: 24,
      }), { width: 80, height: 24 })
    })
    try {
      await act(async () => { await setup.renderOnce() })
      const first = locate(setup.captureCharFrame(), "First option")
      const second = locate(setup.captureCharFrame(), "Second option")
      const frame = setup.captureSpans()
      for (let i = 0; i < "First option".length; i++) {
        expect(cellColors(frame, first.x + i, first.y)).toEqual(colors(selectColors.selectedTextColor, selectColors.selectedBackgroundColor))
      }
      for (let i = 0; i < "Second option".length; i++) {
        expect(cellColors(frame, second.x + i, second.y)).toEqual(colors(selectColors.textColor, selectColors.backgroundColor))
      }
      expect(cellColors(frame, first.x, first.y + 1)).toEqual(colors(selectColors.selectedDescriptionColor, selectColors.selectedBackgroundColor))
      expect(cellColors(frame, second.x, second.y + 1)).toEqual(colors(selectColors.descriptionColor, selectColors.backgroundColor))
    } finally {
      await act(async () => { setup.renderer.destroy() })
    }
  })
})
