import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import type { Fl0wMessage } from "../../../models/agent"
import { buildPlanProgress, buildToolCallInputMap } from "../../lib/format/message"
import { Transcript } from "../transcript/Transcript"
import { fitsPlanSidebar, PLAN_SIDEBAR_WIDTH, PlanSidebar } from "./PlanSidebar"

const LONG_STEP = "Read the existing configuration loader and identify every place where environment overrides are merged into defaults"

const messages: Fl0wMessage[] = [
  { message: { role: "user", content: "do the thing" } },
  {
    subagent: "DISCOVERY",
    message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "r1", toolName: "read", input: { filePath: "src/a.ts" } }] },
  },
  {
    subagent: "DISCOVERY",
    message: { role: "tool", content: [{ type: "tool-result", toolCallId: "r1", toolName: "read", output: { type: "text", value: "x" } }] },
  },
  {
    subagent: "PLAN",
    message: {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: "p1",
        toolName: "create_plan",
        input: { title: "Refactor config", steps: [{ index: 1, description: LONG_STEP }, { index: 2, description: "Ship it" }] },
      }],
    },
  },
  {
    subagent: "PLAN",
    message: { role: "tool", content: [{ type: "tool-result", toolCallId: "p1", toolName: "create_plan", output: { type: "text", value: "ok" } }] },
  },
  {
    subagent: "EXECUTE",
    message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "m1", toolName: "mark_step_complete", input: { index: 1 } }] },
  },
] as Fl0wMessage[]

let destroy: (() => void) | undefined
afterEach(() => destroy?.())

describe("PlanSidebar", () => {
  test("renders next to a journal transcript, with long steps clipped to two lines", async () => {
    const progress = buildPlanProgress(messages)
    expect(progress?.steps.map((step) => step.done)).toEqual([true, false])

    const setup = await testRender(
      <box flexDirection="row" width="100%" height="100%">
        <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} height="100%">
          <Transcript messages={messages} toolCallInputs={buildToolCallInputMap(messages)} planProgress={progress} activePhase={null} streamingText="" />
        </box>
        <PlanSidebar progress={progress!} />
      </box>,
      { width: 120, height: 30 },
    )
    destroy = () => setup.renderer.destroy()
    await setup.renderOnce()
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Refactor config")
    expect(frame).toContain("1/2 complete")
    expect(frame).toContain("1. Read the existing")
    expect(frame).toContain("2. Ship it")
    expect(frame).not.toContain("defaults")
  })
})

describe("fitsPlanSidebar", () => {
  test("hides the sidebar only when it is wider than half the terminal", () => {
    expect(fitsPlanSidebar(PLAN_SIDEBAR_WIDTH * 2)).toBe(true)
    expect(fitsPlanSidebar(PLAN_SIDEBAR_WIDTH * 2 - 1)).toBe(false)
  })
})
