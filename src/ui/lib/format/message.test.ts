import { describe, expect, test } from "bun:test"
import {
  buildPlanProgress,
  buildUnifiedDiff,
  concatenateSubtitle,
  filetypeFromPath,
  looksLikeLineNumberedOutput,
  parseLineNumberedContent,
  parsePlanSteps,
} from "./message"

describe("parseLineNumberedContent", () => {
  test("strips line number prefixes and preserves start line", () => {
    const input = "10: const x = 1\n11: const y = 2"
    expect(parseLineNumberedContent(input)).toEqual({
      content: "const x = 1\nconst y = 2",
      startLine: 10,
    })
  })
})

describe("looksLikeLineNumberedOutput", () => {
  test("detects read tool output", () => {
    expect(looksLikeLineNumberedOutput("1: hello\n2: world")).toBe(true)
    expect(looksLikeLineNumberedOutput("hello world")).toBe(false)
  })
})

describe("filetypeFromPath", () => {
  test("maps common extensions", () => {
    expect(filetypeFromPath("src/index.tsx")).toBe("tsx")
    expect(filetypeFromPath("script.sh")).toBe("bash")
  })
})

describe("parsePlanSteps", () => {
  test("extracts numbered and bulleted steps", () => {
    const input = "1. Read the file\n2. Edit the handler\n- Run tests"
    expect(parsePlanSteps(input)).toEqual([
      "Read the file",
      "Edit the handler",
      "Run tests",
    ])
  })
})

describe("concatenateSubtitle", () => {
  test("joins items with separators", () => {
    expect(concatenateSubtitle(["Read file", "Edit handler"])).toBe(
      "Read file · Edit handler",
    )
  })

  test("truncates long subtitles", () => {
    const subtitle = concatenateSubtitle([
      "Read the configuration file",
      "Update the handler logic",
      "Run the test suite",
    ], 40)

    expect(subtitle).toContain("· +")
    expect(subtitle.length).toBeLessThanOrEqual(50)
  })
})

describe("buildUnifiedDiff", () => {
  test("builds a simple unified diff", () => {
    const diff = buildUnifiedDiff("src/a.ts", "old", "new")
    expect(diff).toContain("--- a/src/a.ts")
    expect(diff).toContain("-old")
    expect(diff).toContain("+new")
  })
})

describe("buildPlanProgress", () => {
  const call = (toolCallId: string, toolName: string, input: unknown) => ({
    message: { role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId, toolName, input }] },
  })
  const steps = [{ index: 1, description: "Read" }, { index: 2, description: "Edit" }]

  test("marks steps completed after the latest plan", () => {
    expect(buildPlanProgress([
      call("p1", "default/create_plan", { steps }),
      call("m1", "default/mark_step_complete", { index: 2 }),
    ])).toEqual({
      toolCallId: "p1",
      steps: [
        { index: 1, description: "Read", done: false },
        { index: 2, description: "Edit", done: true },
      ],
    })
  })

  test("a new plan resets progress", () => {
    const progress = buildPlanProgress([
      call("p1", "default/create_plan", { steps }),
      call("m1", "default/mark_step_complete", { index: 1 }),
      call("p2", "default/create_plan", { steps }),
    ])
    expect(progress?.toolCallId).toBe("p2")
    expect(progress?.steps.every((step) => !step.done)).toBe(true)
  })

  test("returns undefined without a structured plan", () => {
    expect(buildPlanProgress([call("p1", "default/create_plan", { plan: "1. Read" })])).toBeUndefined()
  })
})
