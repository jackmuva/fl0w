import { describe, expect, test } from "bun:test"
import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import { groupEntries, groupTranscript, truncateMiddle } from "./segments"

const user = (text: string): Fl0wMessage => ({ message: { role: "user", content: text } })
const text = (value: string, subagent?: SubagentType): Fl0wMessage => ({
  message: { role: "assistant", content: value },
  ...(subagent && { subagent }),
})
const call = (toolCallId: string, toolName: string, input: unknown, subagent: SubagentType = "EXECUTE"): Fl0wMessage => ({
  message: { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input }] },
  subagent,
})
const result = (toolCallId: string, toolName: string, value: string, error = false, subagent: SubagentType = "EXECUTE"): Fl0wMessage => ({
  message: {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId,
      toolName,
      output: error ? { type: "error-text", value } : { type: "text", value },
    }],
  },
  subagent,
})

describe("groupTranscript", () => {
  test("groups contiguous messages of the same phase", () => {
    const segments = groupTranscript([
      user("hi"),
      text("looking", "DISCOVERY"),
      call("c1", "default__read", { path: "a.ts" }, "DISCOVERY"),
      call("p1", "default__create_plan", { steps: [] }, "PLAN"),
      text("doing", "EXECUTE"),
      { ...text("summary"), compacted: true },
    ])

    expect(segments.map((segment) => segment.kind === "phase"
      ? `${segment.subagent}@${segment.startIndex}x${segment.messages.length}`
      : segment.kind === "burst" ? `burst@${segment.startIndex}` : `single@${segment.index}`)).toEqual([
      "single@0",
      "DISCOVERY@1x2",
      "PLAN@3x1",
      "EXECUTE@4x1",
      "single@5",
    ])
  })

  test("a user message splits the same phase into two segments", () => {
    const segments = groupTranscript([text("a", "EXECUTE"), user("more"), text("b", "EXECUTE")])
    expect(segments.map((segment) => segment.kind)).toEqual(["phase", "single", "phase"])
  })
})

describe("groupEntries", () => {
  const shape = (messages: Fl0wMessage[]) => groupEntries(messages).map((entry) => entry.kind === "burst"
    ? `burst@${entry.startIndex}x${entry.messages.length}`
    : `single@${entry.index}${entry.hideToolCalls ? "-prose" : ""}`)

  test("collects consecutive tool calls and results into one burst", () => {
    expect(shape([
      user("go"),
      call("c1", "default__read", { filePath: "a.ts" }),
      result("c1", "default__read", "1: a"),
      call("c2", "default__bash", { command: "ls" }),
      result("c2", "default__bash", "a.ts"),
      text("done"),
    ])).toEqual(["single@0", "burst@1x4", "single@5"])
  })

  test("splits prose from the tool calls in the same message", () => {
    const mixed: Fl0wMessage = {
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool-call", toolCallId: "c1", toolName: "default__read", input: { filePath: "a.ts" } },
        ],
      },
    }
    expect(shape([mixed, result("c1", "default__read", "1: a")])).toEqual(["single@0-prose", "burst@0x2"])
  })

  test("standalone tools end a burst", () => {
    expect(shape([
      call("c1", "default__read", { filePath: "a.ts" }),
      result("c1", "default__read", "1: a"),
      call("p1", "default__create_plan", { steps: [] }),
      result("p1", "default__create_plan", "plan"),
      call("c2", "default__read", { filePath: "b.ts" }),
    ])).toEqual(["burst@0x2", "single@2", "single@3", "burst@4x1"])
  })
})

describe("groupTranscript bursts", () => {
  test("groups loose tool calls outside a phase", () => {
    const segments = groupTranscript([
      user("go"),
      { message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "default__read", input: {} }] } },
      text("phase", "EXECUTE"),
    ])
    expect(segments.map((segment) => segment.kind)).toEqual(["single", "burst", "phase"])
  })
})

describe("truncateMiddle", () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => `${index}`)

  test("keeps every row when they fit", () => {
    expect(truncateMiddle(rows(6))).toEqual({ head: rows(6), hiddenCount: 0, tail: [] })
  })

  test("hides the middle rows", () => {
    const truncated = truncateMiddle(rows(10))
    expect(truncated.head).toEqual(["0", "1", "2"])
    expect(truncated.hiddenCount).toBe(4)
    expect(truncated.tail).toEqual(["7", "8", "9"])
  })
})
