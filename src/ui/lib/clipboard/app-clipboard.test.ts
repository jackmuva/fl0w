import { describe, expect, test } from "bun:test"
import type { ClipboardService } from "@opentui/core"
import { writeSelectionText } from "./app-clipboard"

const mockClipboard = (
  writeImpl: ClipboardService["writeText"],
): ClipboardService => ({
  read: async () => ({ status: "empty" }),
  writeText: writeImpl,
  clear: async () => ({
    host: { status: "not-attempted" },
    terminal: { status: "not-attempted", capability: "unknown" },
  }),
  dispose: async () => {},
})

describe("writeSelectionText", () => {
  test("returns false for empty text", async () => {
    const service = mockClipboard(async () => ({
      host: { status: "written" },
      terminal: { status: "not-attempted", capability: "unknown" },
    }))
    expect(await writeSelectionText(service, "")).toBe(false)
  })

  test("returns true when host write succeeds", async () => {
    const service = mockClipboard(async () => ({
      host: { status: "written" },
      terminal: { status: "not-attempted", capability: "unknown" },
    }))
    expect(await writeSelectionText(service, "hello")).toBe(true)
  })

  test("returns true when terminal OSC 52 is attempted", async () => {
    const service = mockClipboard(async () => ({
      host: { status: "unsupported" },
      terminal: { status: "attempted", capability: "supported" },
    }))
    expect(await writeSelectionText(service, "remote copy")).toBe(true)
  })

  test("returns false when both destinations fail", async () => {
    const service = mockClipboard(async () => ({
      host: { status: "failed", error: new Error("nope") },
      terminal: { status: "local-failure", capability: "unsupported" },
    }))
    expect(await writeSelectionText(service, "hello")).toBe(false)
  })
})
