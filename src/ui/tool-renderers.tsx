import { createElement, type ComponentType, type ReactNode } from "react"
import type { ToolViewProps } from "../models/ui"
import { parseToolKey } from "../models/mcp"
import { ApplyPatchToolCallView, ApplyPatchToolResultView } from "./components/tools/ApplyPatchToolView"
import { AskQuestionToolCallView, AskQuestionToolResultView } from "./components/tools/AskQuestionToolView"
import { BashToolCallView, BashToolResultView } from "./components/tools/BashToolView"
import { DefaultToolCallView, SmartDefaultToolResultView } from "./components/tools/DefaultToolViews"
import { EditToolCallView, EditToolResultView } from "./components/tools/EditToolView"
import { GlobToolCallView, GlobToolResultView } from "./components/tools/GlobToolView"
import { GrepToolCallView, GrepToolResultView } from "./components/tools/GrepToolView"
import { ListDirToolCallView, ListDirToolResultView } from "./components/tools/ListDirToolView"
import { ReadToolCallView, ReadToolResultView } from "./components/tools/ReadToolView"
import { MessageAnswerToolCallView, MessageAnswerToolResultView } from "./components/tools/MessageAnswerToolView"
import {
  MarkStepCompleteToolCallView,
  MarkStepCompleteToolResultView,
  PlanToolCallView,
  PlanToolResultView,
} from "./components/tools/PlanToolView"
import { WebFetchToolCallView, WebFetchToolResultView } from "./components/tools/WebFetchToolView"
import { WebSearchToolCallView, WebSearchToolResultView } from "./components/tools/WebSearchToolView"
import { WriteToolCallView, WriteToolResultView } from "./components/tools/WriteToolView"

type ToolComponent = ComponentType<ToolViewProps>

const toolResultComponents: Record<string, ToolComponent> = {
  "default__read": ReadToolResultView,
  "default__bash": BashToolResultView,
  "default__grep": GrepToolResultView,
  "default__edit": EditToolResultView,
  "default__apply_patch": ApplyPatchToolResultView,
  "default__write": WriteToolResultView,
  "default__glob": GlobToolResultView,
  "default__list_dir": ListDirToolResultView,
  "default__webfetch": WebFetchToolResultView,
  "default__websearch": WebSearchToolResultView,
  "default__message_answer": MessageAnswerToolResultView,
  "default__ask_question": AskQuestionToolResultView,
  "default__create_plan": PlanToolResultView,
  "default__mark_step_complete": MarkStepCompleteToolResultView,
}

const toolCallComponents: Record<string, ToolComponent> = {
  "default__read": ReadToolCallView,
  "default__bash": BashToolCallView,
  "default__grep": GrepToolCallView,
  "default__edit": EditToolCallView,
  "default__apply_patch": ApplyPatchToolCallView,
  "default__write": WriteToolCallView,
  "default__glob": GlobToolCallView,
  "default__list_dir": ListDirToolCallView,
  "default__webfetch": WebFetchToolCallView,
  "default__websearch": WebSearchToolCallView,
  "default__message_answer": MessageAnswerToolCallView,
  "default__ask_question": AskQuestionToolCallView,
  "default__create_plan": PlanToolCallView,
  "default__mark_step_complete": MarkStepCompleteToolCallView,
}

const lookupComponent = (
  registry: Record<string, ToolComponent>,
  toolName: string,
): ToolComponent | undefined =>
  registry[toolName] ?? registry[`default__${parseToolKey(toolName).name}`]

export const renderToolResult = (ctx: ToolViewProps): ReactNode => {
  const Component = lookupComponent(toolResultComponents, ctx.toolName) ?? SmartDefaultToolResultView
  return createElement(Component, ctx)
}

export const renderToolCall = (ctx: ToolViewProps): ReactNode => {
  const Component = lookupComponent(toolCallComponents, ctx.toolName) ?? DefaultToolCallView
  return createElement(Component, ctx)
}
