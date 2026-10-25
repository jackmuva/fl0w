import { createElement, type ComponentType, type ReactNode } from "react"
import type { ToolViewProps } from "../models/ui"
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

const stripToolServer = (toolName: string) => toolName.split("/").pop() ?? toolName

const toolResultComponents: Record<string, ToolComponent> = {
  "default/read": ReadToolResultView,
  "default/bash": BashToolResultView,
  "default/grep": GrepToolResultView,
  "default/edit": EditToolResultView,
  "default/apply_patch": ApplyPatchToolResultView,
  "default/write": WriteToolResultView,
  "default/glob": GlobToolResultView,
  "default/list_dir": ListDirToolResultView,
  "default/webfetch": WebFetchToolResultView,
  "default/websearch": WebSearchToolResultView,
  "default/message_answer": MessageAnswerToolResultView,
  "default/ask_question": AskQuestionToolResultView,
  "default/create_plan": PlanToolResultView,
  "default/mark_step_complete": MarkStepCompleteToolResultView,
}

const toolCallComponents: Record<string, ToolComponent> = {
  "default/read": ReadToolCallView,
  "default/bash": BashToolCallView,
  "default/grep": GrepToolCallView,
  "default/edit": EditToolCallView,
  "default/apply_patch": ApplyPatchToolCallView,
  "default/write": WriteToolCallView,
  "default/glob": GlobToolCallView,
  "default/list_dir": ListDirToolCallView,
  "default/webfetch": WebFetchToolCallView,
  "default/websearch": WebSearchToolCallView,
  "default/message_answer": MessageAnswerToolCallView,
  "default/ask_question": AskQuestionToolCallView,
  "default/create_plan": PlanToolCallView,
  "default/mark_step_complete": MarkStepCompleteToolCallView,
}

const lookupComponent = (
  registry: Record<string, ToolComponent>,
  toolName: string,
): ToolComponent | undefined =>
  registry[toolName] ?? registry[`default/${stripToolServer(toolName)}`]

export const renderToolResult = (ctx: ToolViewProps): ReactNode => {
  const Component = lookupComponent(toolResultComponents, ctx.toolName) ?? SmartDefaultToolResultView
  return createElement(Component, ctx)
}

export const renderToolCall = (ctx: ToolViewProps): ReactNode => {
  const Component = lookupComponent(toolCallComponents, ctx.toolName) ?? DefaultToolCallView
  return createElement(Component, ctx)
}
