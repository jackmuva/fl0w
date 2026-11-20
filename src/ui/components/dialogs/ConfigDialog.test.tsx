import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { RGBA, TextareaRenderable, type CapturedFrame } from "@opentui/core"
import { act } from "react"
import type { CapabilityCatalog, CapabilitySelection, ModelMetadata } from "../../../models/agent"
import { textareaColors, theme } from "../../theme"
import { ConfigDialog } from "./ConfigDialog"

const catalog: CapabilityCatalog = { skills: [], mcpServers: [], userTools: [], agentsMd: [] }
const selection: CapabilitySelection = { skills: [], mcpServers: [], userTools: [], agentsMd: [] }
const models: ModelMetadata[] = [
  { model: "a-very-long-text-model-name", type: "text", contextWindow: 1000, inputTokenPrice: 123456, outputTokenPrice: 789012 },
  { model: "spare-model", type: "text", contextWindow: 1000, inputTokenPrice: 1, outputTokenPrice: 2 },
  { model: "router-model", type: "decision", contextWindow: 1000, inputTokenPrice: 0.1, outputTokenPrice: 0.2 },
]

let destroy: (() => void) | undefined
afterEach(async () => {
  await act(async () => { destroy?.() })
  destroy = undefined
})

const renderDialog = async (width: number) => {
  let setup!: Awaited<ReturnType<typeof testRender>>
  await act(async () => { setup = await testRender(
    <ConfigDialog
      catalog={catalog}
      models={models}
      initialSelection={selection}
      initialModels={null}
      onConfirm={() => {}}
      onDismiss={() => {}}
      terminalWidth={width}
      terminalHeight={30}
    />,
    { width, height: 30 },
  ) })
  destroy = () => setup.renderer.destroy()
  await act(async () => { await setup.renderOnce() })
  return setup
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
const locate = (frame: string, text: string) => {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  expect(y).toBeGreaterThanOrEqual(0)
  return { x: lines[y]!.indexOf(text), y }
}

describe("ConfigDialog model rows", () => {
  test("shows complete phase labels, separators and prices at normal width", async () => {
    const frame = (await renderDialog(80)).captureCharFrame()
    expect(frame).toContain("$123456.00/$789012.00 | Plan/Execute")
    expect(frame).toContain("$0.10/$0.20 | Router")
    expect(frame).toContain("spare-model")
    expect(frame).toContain("$1.00/$2.00")
  })

  test("preserves full phase labels when names and prices must shrink", async () => {
    const frame = (await renderDialog(32)).captureCharFrame()
    const textRow = frame.split("\n").find((line) => line.includes("Plan/Execute"))
    const routerRow = frame.split("\n").find((line) => line.includes("Router"))
    expect(textRow).toContain("… $123… | Plan/Execute")
    expect(routerRow).toContain(" | Router")
    expect(routerRow).toContain("$0.10/$0.20")
  })

  test("renders highlighted name, price, separator and phases white on the dark highlight", async () => {
    const setup = await renderDialog(80)
    const chars = setup.captureCharFrame()
    const spans = setup.captureSpans()
    for (const text of ["a-very-long-text", "$123456.00/$789012.00", " | Plan/Execute"]) {
      const { x, y } = locate(chars, text)
      for (let i = 0; i < text.length; i++) {
        expect(cellColors(spans, x + i, y)).toEqual(colors("#FFFFFF", theme.highlight))
      }
    }
    const spare = locate(chars, "spare-model")
    expect(cellColors(spans, spare.x, spare.y)).toEqual(colors(theme.muted, theme.paperRaised))
  })
})

test("textareaColors paints selected input white on the highlight only", async () => {
  let setup!: Awaited<ReturnType<typeof testRender>>
  await act(async () => { setup = await testRender(<textarea {...textareaColors} width={25} height={3} focused />, { width: 30, height: 5 }) })
  destroy = () => setup.renderer.destroy()
  const textarea = setup.renderer.root.getChildren().find((node): node is TextareaRenderable => node instanceof TextareaRenderable)
  expect(textarea).toBeDefined()
  await act(async () => { textarea!.setText("select this input"); await setup.renderOnce() })
  const { x, y } = locate(setup.captureCharFrame(), "select this input")
  const before = cellColors(setup.captureSpans(), x + 6, y)
  await act(async () => { await setup.mockMouse.drag(x, y, x + 5, y); await setup.renderOnce() })
  expect(setup.renderer.getSelection()?.getSelectedText()).toBe("select")
  const frame = setup.captureSpans()
  for (let i = 0; i < 6; i++) {
    expect(cellColors(frame, x + i, y)).toEqual(colors(textareaColors.selectionFg, textareaColors.selectionBg))
    expect(cellColors(frame, x + i, y)).toEqual(colors("#FFFFFF", theme.highlight))
  }
  expect(cellColors(frame, x + 6, y)).toEqual(before)
  expect(before).not.toEqual(colors(textareaColors.selectionFg, textareaColors.selectionBg))
})
