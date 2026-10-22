import type { Fl0wMessage } from "../../../models/agent";
import type { AskQuestionInput, AskQuestionItem } from "../default-tools/ask-question";
import { ASK_QUESTION_ACTION } from "./tools";

export type PendingAskQuestion = {
  toolCallId: string;
  toolName: string;
  input: AskQuestionInput;
};

export type QuestionAnswer = {
  optionId: string;
  customText: string;
};

export const getQuestionPrompt = (question: AskQuestionItem) =>
  question.prompt ?? question.question ?? question.id;

const normalizeAskQuestionInput = (input: unknown): AskQuestionInput => {
  const raw = input as AskQuestionInput;
  return {
    title: raw.title,
    questions: (raw.questions ?? []).map((question) => ({
      ...question,
      prompt: getQuestionPrompt(question),
      options: question.options ?? [],
    })),
  };
};

export const findPendingAskQuestion = (
  messages: Fl0wMessage[],
): PendingAskQuestion | null => {
  let pending: PendingAskQuestion | null = null;

  for (const { message } of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "tool-call" && part.toolName === ASK_QUESTION_ACTION) {
          pending = {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: normalizeAskQuestionInput(part.input),
          };
        }
      }
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          part.type === "tool-result" &&
          pending?.toolCallId === part.toolCallId
        ) {
          pending = null;
        }
      }
    }
  }

  return pending;
};

export const formatAskQuestionAnswers = (
  questions: AskQuestionItem[],
  answers: Record<string, QuestionAnswer>,
): string => {
  const lines = questions.map((question) => {
    const answer = answers[question.id];
    if (!answer) return `${getQuestionPrompt(question)}: (no answer)`;

    if (answer.optionId === "other") {
      return `${getQuestionPrompt(question)}: ${answer.customText.trim() || "(no answer)"}`;
    }

    const label =
      question.options.find((option) => option.id === answer.optionId)?.label ??
      answer.optionId;
    return `${getQuestionPrompt(question)}: ${label}`;
  });

  return lines.join("\n");
};

export const isQuestionAnswerComplete = (
  question: AskQuestionItem,
  answer: QuestionAnswer | undefined,
): boolean => {
  if (!answer?.optionId) return false;
  if (answer.optionId === "other") return answer.customText.trim().length > 0;
  return question.options.some((option) => option.id === answer.optionId);
};
