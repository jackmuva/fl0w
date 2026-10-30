import { describe, expect, test } from "bun:test"
import type { Fl0wMessage } from "../../../models/agent"
import {
  buildJournalSteps,
  composeSentence,
  describeToolCall,
  diffStats,
  sentenceText,
} from "./journal"

const call = (toolCallId: string, toolName: string, input: unknown): Fl0wMessage => ({
  message: { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input }] },
})
const result = (toolCallId: string, toolName: string, value: string, error = false): Fl0wMessage => ({
  message: {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId,
      toolName,
      output: error ? { type: "error-text", value } : { type: "text", value },
    }],
  },
})

const sentence = (messages: Fl0wMessage[]) => sentenceText(composeSentence(buildJournalSteps(messages)))

describe("buildJournalSteps", () => {
  test("pairs calls with results and skips standalone tools", () => {
    const steps = buildJournalSteps([
      call("c1", "default__bash", { command: "ls" }),
      result("c1", "default__bash", "a"),
      call("c2", "default__read", { filePath: "x.ts" }),
      result("c2", "default__read", "missing", true),
      call("c3", "default__grep", { pattern: "foo" }),
      call("q1", "default__ask_question", { questions: [] }),
    ])
    expect(steps.map((step) => `${step.toolCallId}:${step.status}`)).toEqual(["c1:ok", "c2:error", "c3:pending"])
  })
})

describe("composeSentence", () => {
  test("joins different steps into one sentence", () => {
    expect(sentence([
      call("c1", "default__read", { filePath: "src/session.ts" }),
      result("c1", "default__read", "1: x"),
      call("c2", "default__grep", { pattern: "saveSession" }),
      result("c2", "default__grep", "hit"),
      call("c3", "default__bash", { command: "bun test session" }),
      result("c3", "default__bash", "fail", true),
    ])).toBe('read session.ts, searched for "saveSession", and ran bun test session (1 failed)')
  })

  test("merges repeats of the same verb", () => {
    expect(sentence([
      call("a", "default__read", { filePath: "a.ts" }),
      call("b", "default__read", { filePath: "b.ts" }),
      result("a", "default__read", ""),
      result("b", "default__read", ""),
    ])).toBe("read a.ts and b.ts")

    expect(sentence(["a", "b", "c"].flatMap((id) => [
      call(id, "default__read", { filePath: `${id}.ts` }),
      result(id, "default__read", ""),
    ]))).toBe("read 3 files")
  })

  test("sums diff stats across edits", () => {
    expect(sentence([
      call("e1", "default__edit", { filePath: "a.ts", oldString: "x\ny", newString: "x\nz\nw" }),
      result("e1", "default__edit", "ok"),
      call("e2", "default__edit", { filePath: "b.ts", oldString: "q", newString: "r" }),
      result("e2", "default__edit", "ok"),
    ])).toBe("edited a.ts and b.ts (+3 −2)")
  })

  test("in-flight steps read in the present tense", () => {
    expect(sentence([
      call("c1", "default__read", { filePath: "a.ts" }),
      result("c1", "default__read", ""),
      call("c2", "default__bash", { command: "bun test" }),
    ])).toBe("read a.ts, now running bun test…")
  })

  test("marks file names and commands as nouns", () => {
    const fragments = composeSentence(buildJournalSteps([call("c1", "default__bash", { command: "ls" })]))
    expect(fragments.filter((fragment) => fragment.noun).map((fragment) => fragment.text)).toEqual(["ls"])
  })

  test("falls back to the tool name for unknown tools", () => {
    expect(sentence([call("m1", "linear__create_issue", {}), result("m1", "linear__create_issue", "ok")]))
      .toBe("used create_issue")
  })
})

describe("diffStats", () => {
  test("ignores shared leading and trailing lines", () => {
    expect(diffStats("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 })
    expect(diffStats("", "a\nb")).toEqual({ added: 2, removed: 0 })
  })
})

describe("describeToolCall", () => {
  test("labels calls by their primary input", () => {
    expect(describeToolCall("default__bash", { command: "ls src\nls test" })).toBe("bash · ls src")
    expect(describeToolCall("default__read", { filePath: "a.ts" })).toBe("read · a.ts")
    expect(describeToolCall("default__create_plan", { title: "Refactor", steps: [{ index: 1, description: "a" }] }))
      .toBe("plan · Refactor · 1 steps")
  })
})
