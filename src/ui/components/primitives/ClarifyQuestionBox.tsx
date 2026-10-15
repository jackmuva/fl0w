import { useKeyboard } from "@opentui/react"
import { useMemo, useState } from "react"
import type {
  AskQuestionInput,
  AskQuestionOption,
  AskQuestionItem,
} from "../../../services/agent/default-tools/ask-question"
import {
  formatAskQuestionAnswers,
  getQuestionPrompt,
  type QuestionAnswer,
} from "../../../services/agent/utils/ask-question-state"
import { AGENT_BORDER_COLOR } from "./MessageFrame"

const OTHER_OPTION_ID = "other"
const ACCENT_FG = "#e6d5b8"
const TEXT_FG = "#c0caf5"
const MUTED_FG = "#565f89"
const DONE_FG = "#9ece6a"

const withOtherOption = (options: AskQuestionOption[]): AskQuestionOption[] =>
  options.some((option) => option.id === OTHER_OPTION_ID)
    ? options
    : [...options, { id: OTHER_OPTION_ID, label: "Other" }]

const answerLabel = (question: AskQuestionItem, answer: QuestionAnswer): string =>
  answer.optionId === OTHER_OPTION_ID
    ? answer.customText.trim()
    : (question.options.find((option) => option.id === answer.optionId)?.label ??
      answer.optionId)

const isSubmitKey = (name: string) =>
  name === "return" || name === "kpenter" || name === "linefeed"

type ClarifyQuestionBoxProps = {
  input: AskQuestionInput
  onSubmit: (answersText: string) => void
}

export const ClarifyQuestionBox = ({ input, onSubmit }: ClarifyQuestionBoxProps) => {
  const questions = useMemo(
    () =>
      input.questions.map((question) => ({
        ...question,
        options: withOtherOption(question.options),
      })),
    [input.questions],
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [typingOther, setTypingOther] = useState(false)
  const [customText, setCustomText] = useState("")
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})

  const question = questions[currentIndex]
  const options = question?.options ?? []

  const goToQuestion = (index: number, nextAnswers: Record<string, QuestionAnswer>) => {
    const target = questions[index]
    const previous = target ? nextAnswers[target.id] : undefined
    const previousIndex = previous
      ? target!.options.findIndex((option) => option.id === previous.optionId)
      : -1
    setCurrentIndex(index)
    setHighlightedIndex(Math.max(0, previousIndex))
    setCustomText(previous?.customText ?? "")
    setTypingOther(false)
  }

  const commitAnswer = (answer: QuestionAnswer) => {
    if (!question) return
    const nextAnswers = { ...answers, [question.id]: answer }
    setAnswers(nextAnswers)

    if (currentIndex === questions.length - 1) {
      onSubmit(formatAskQuestionAnswers(questions, nextAnswers))
      return
    }
    goToQuestion(currentIndex + 1, nextAnswers)
  }

  useKeyboard((key) => {
    if (!question) return

    if (typingOther) {
      if (key.name === "escape") {
        setTypingOther(false)
        return
      }
      if (isSubmitKey(key.name) && customText.trim()) {
        commitAnswer({ optionId: OTHER_OPTION_ID, customText })
      }
      return
    }

    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setHighlightedIndex((index) => (index - 1 + options.length) % options.length)
      return
    }

    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setHighlightedIndex((index) => (index + 1) % options.length)
      return
    }

    if (isSubmitKey(key.name)) {
      const option = options[highlightedIndex]
      if (!option) return
      if (option.id === OTHER_OPTION_ID) {
        setTypingOther(true)
        return
      }
      commitAnswer({ optionId: option.id, customText: "" })
      return
    }

    if ((key.name === "escape" || key.name === "left") && currentIndex > 0) {
      goToQuestion(currentIndex - 1, answers)
    }
  })

  if (!question) return null

  const total = questions.length
  const answered = questions.slice(0, currentIndex)
  const hint = typingOther
    ? "Enter to confirm · Esc to cancel"
    : `↑↓ to choose · Enter to select${currentIndex > 0 ? " · Esc to go back" : ""}`

  return (
    <box
      border={true}
      borderColor={AGENT_BORDER_COLOR}
      paddingLeft={1}
      paddingRight={1}
      marginY={1}
      width="100%"
      flexDirection="column"
      flexShrink={0}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={MUTED_FG}>{input.title ?? "Clarifying questions"}</text>
        {total > 1 && <text fg={MUTED_FG}>{`${currentIndex + 1}/${total}`}</text>}
      </box>

      {answered.map((item) => {
        const answer = answers[item.id]
        return (
          <text key={item.id} fg={MUTED_FG}>
            <span fg={DONE_FG}>✓ </span>
            {getQuestionPrompt(item)}
            {answer ? <span fg={TEXT_FG}>{` ${answerLabel(item, answer)}`}</span> : null}
          </text>
        )
      })}

      <text fg={TEXT_FG} marginTop={answered.length > 0 ? 1 : 0}>
        <strong>{getQuestionPrompt(question)}</strong>
      </text>

      <box flexDirection="column" marginTop={1} width="100%">
        {options.map((option, index) => {
          const active = index === highlightedIndex
          return (
            <text key={option.id} fg={active ? ACCENT_FG : TEXT_FG}>
              {active ? "❯ " : "  "}
              {option.label}
            </text>
          )
        })}
      </box>

      {typingOther && (
        <box flexDirection="row" marginTop={1} width="100%">
          <text fg={ACCENT_FG}>{"› "}</text>
          <input
            placeholder="Type your answer..."
            value={customText}
            flexGrow={1}
            focused={true}
            onInput={setCustomText}
          />
        </box>
      )}

      <text fg={MUTED_FG} marginTop={1}>
        {hint}
      </text>
    </box>
  )
}
