import { describe, expect, test } from "bun:test"
import { extractFileReferences, parseUserAttachments, resolveUserMessage } from "./at-files"

describe("extractFileReferences", () => {
  test("finds file references in text", () => {
    expect(extractFileReferences("review @src/ui/App.tsx please")).toEqual(["src/ui/App.tsx"])
  })
})

describe("resolveUserMessage", () => {
  test("passes through plain text", async () => {
    await expect(resolveUserMessage("hello")).resolves.toEqual({
      role: "user",
      content: "hello",
    })
  })

  test("attaches referenced file content", async () => {
    const message = await resolveUserMessage("explain @README.md")
    expect(message.role).toBe("user")
    expect(typeof message.content).toBe("string")
    expect(message.content).toContain("explain @README.md")
    expect(message.content).toContain("[Attached: README.md]")
    expect(message.content).toContain("fl0w")
  })
})

describe("parseUserAttachments", () => {
  test("returns plain text when no attachments are present", () => {
    expect(parseUserAttachments("hello")).toEqual({
      prompt: "hello",
      attachments: [],
    })
  })

  test("splits prompt text from attached file blocks", () => {
    const content = "explain @README.md\n\n[Attached: README.md]\n# fl0w\n\n[Attached: package.json]\n{}"
    expect(parseUserAttachments(content)).toEqual({
      prompt: "explain @README.md",
      attachments: [
        { path: "README.md", content: "# fl0w" },
        { path: "package.json", content: "{}" },
      ],
    })
  })
})
