import type { ToolViewProps } from "../../../models/ui"
import { asRecord } from "../../lib/format/message"
import { USER_INPUT_BORDER_COLOR } from "../primitives/MessageFrame"

const MUTED_FG = "#565f89"
const ACCENT_FG = "#e6d5b8"

const readPrompts = (input: unknown): string[] => {
  const questions = asRecord(input)?.questions
  if (!Array.isArray(questions)) return []

  return questions
    .map((question) => {
      const record = asRecord(question)
      const prompt = record?.prompt ?? record?.question
      return typeof prompt === "string" ? prompt : undefined
    })
    .filter((prompt): prompt is string => Boolean(prompt))
}

const splitAnswerLine = (line: string, prompts: string[]) => {
  const prompt = prompts.find((candidate) => line.startsWith(`${candidate}: `))
  if (prompt) return { prompt, answer: line.slice(prompt.length + 2) }

  const separator = line.indexOf(": ")
  return separator === -1
    ? { prompt: undefined, answer: line }
    : { prompt: line.slice(0, separator), answer: line.slice(separator + 2) }
}

export const AskQuestionToolResultView = (props: ToolViewProps) => {
  const prompts = readPrompts(props.input)
  const lines = props.text.split("\n").filter((line) => line.trim())

  return (
    <box width="100%" flexDirection="column" flexShrink={0} marginBottom={1}>
      <text fg={USER_INPUT_BORDER_COLOR} selectable={false}>› your answers</text>
      {lines.map((line, index) => {
        const { prompt, answer } = splitAnswerLine(line, prompts)
        return (
          <box key={index} paddingLeft={2}>
            <text>
              {prompt ? <span fg={MUTED_FG}>{`${prompt} `}</span> : null}
              {answer}
            </text>
          </box>
        )
      })}
    </box>
  )
}

export const AskQuestionToolCallView = (props: ToolViewProps) => {
  const prompts = readPrompts(props.input)
  const count = prompts.length

  return (
    <box flexDirection="column" marginBottom={1} width="100%">
      <text fg={ACCENT_FG}>
        {`? Asked ${count || "a"} clarifying question${count === 1 || count === 0 ? "" : "s"}`}
      </text>
      {prompts.map((prompt, index) => (
        <text key={index} fg={MUTED_FG}>{`  ${prompt}`}</text>
      ))}
    </box>
  )
}
