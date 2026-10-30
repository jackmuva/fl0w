import { describe, expect, test } from "bun:test"
import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import { buildPhaseDigest, groupTranscript, truncateDigest, type DigestRow } from "./segments"

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
      : `single@${segment.index}`)).toEqual([
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

describe("buildPhaseDigest", () => {
  test("pairs tool calls with their results", () => {
    expect(buildPhaseDigest([
      call("c1", "default__bash", { command: "ls src\nls test" }),
      result("c1", "default__bash", "index.tsx"),
      call("c2", "default__read", { path: "missing.ts" }),
      result("c2", "default__read", "not found", true),
      call("c3", "mcp__thing", {}),
    ])).toEqual([
      { status: "ok", label: "bash · ls src" },
      { status: "error", label: "read · missing.ts" },
      { status: "pending", label: "thing" },
    ])
  })

  test("summarises plan tools and skips ask_question", () => {
    expect(buildPhaseDigest([
      call("p1", "default__create_plan", { title: "Refactor", steps: [{ index: 1, description: "a" }, { index: 2, description: "b" }] }),
      result("p1", "default__create_plan", "Refactor\n1. a\n2. b"),
      call("m1", "default__mark_step_complete", { index: 2 }),
      result("m1", "default__mark_step_complete", "Step 2 marked complete"),
      call("q1", "default__ask_question", { questions: [] }),
    ])).toEqual([
      { status: "ok", label: "plan · Refactor · 2 steps" },
      { status: "ok", label: "step 2 complete" },
    ])
  })

  test("uses the first line of assistant text", () => {
    expect(buildPhaseDigest([text("\n  First line  \nsecond", "EXECUTE")])).toEqual([
      { status: "text", label: "First line" },
    ])
  })
})

describe("truncateDigest", () => {
  const rows = (count: number): DigestRow[] =>
    Array.from({ length: count }, (_, index) => ({ status: "ok", label: `${index}` }))

  test("keeps every row when they fit", () => {
    expect(truncateDigest(rows(6))).toEqual({ head: rows(6), hiddenCount: 0, tail: [] })
  })

  test("hides the middle rows", () => {
    const truncated = truncateDigest(rows(10))
    expect(truncated.head.map((row) => row.label)).toEqual(["0", "1", "2"])
    expect(truncated.hiddenCount).toBe(4)
    expect(truncated.tail.map((row) => row.label)).toEqual(["7", "8", "9"])
  })
})
