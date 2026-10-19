import { describe, expect, test } from "bun:test"
import {
  executeSlashCommand,
  findSlashCommand,
  getSlashCompletions,
} from "./slash-commands"

describe("slash commands", () => {
  test("lists slash command completions", () => {
    const items = getSlashCompletions("")
    expect(items.map((item) => item.label)).toEqual([
      "/clear",
      "/configure",
      "/generate",
      "/sessions",
      "/workflow",
    ])
  })

  test("filters completions by prefix", () => {
    const items = getSlashCompletions("se")
    expect(items.map((item) => item.label)).toEqual(["/sessions"])
  })

  test("filters completions with fuzzy matching", () => {
    const items = getSlashCompletions("cng")
    expect(items.map((item) => item.label)).toEqual(["/configure"])
  })

  test("finds slash command from input", () => {
    expect(findSlashCommand("/clear")?.name).toBe("clear")
    expect(findSlashCommand("/sessions please")?.name).toBe("sessions")
    expect(findSlashCommand("hello")).toBeNull()
  })

  test("executes clear, sessions, configure, generate, and workflow handlers", () => {
    const calls: string[] = []
    const handlers = {
      clearInput: () => calls.push("clearInput"),
      clearSession: () => calls.push("clearSession"),
      resumeSession: () => calls.push("resumeSession"),
      configureCapabilities: () => calls.push("configureCapabilities"),
      generateWorkflow: () => calls.push("generateWorkflow"),
      runWorkflow: () => calls.push("runWorkflow"),
    }

    expect(executeSlashCommand("clear", handlers)).toBe(true)
    expect(calls).toEqual(["clearSession", "clearInput"])

    calls.length = 0
    expect(executeSlashCommand("sessions", handlers)).toBe(true)
    expect(calls).toEqual(["resumeSession", "clearInput"])

    calls.length = 0
    expect(executeSlashCommand("configure", handlers)).toBe(true)
    expect(calls).toEqual(["configureCapabilities", "clearInput"])

    calls.length = 0
    expect(executeSlashCommand("generate", handlers)).toBe(true)
    expect(calls).toEqual(["generateWorkflow", "clearInput"])

    calls.length = 0
    expect(executeSlashCommand("workflow", handlers)).toBe(true)
    expect(calls).toEqual(["runWorkflow", "clearInput"])

    expect(executeSlashCommand("unknown", handlers)).toBe(false)
  })
})
