import type { BoxRenderable } from "@opentui/core"
import type { ReactNode } from "react"
import { createContext, useContext, useState } from "react"
import { ExpandableRow } from "./ExpandableRow"

export const AGENT_BORDER_COLOR = "#565f89"
export const USER_INPUT_BORDER_COLOR = "#e0af68"
export const CREAM_FG = "#e6d5b8"
export const ORANGE_FG = "#ff9e64"
export const GREEN_FG = "#9ece6a"
export const SUMMARY_BORDER_COLOR = ORANGE_FG
export const WORKFLOW_BORDER_COLOR = CREAM_FG
export const MESSAGE_FRAME_MAX_HEIGHT = 14
const MUTED_FG = "#565f89"
const CALL_LABEL_FG = CREAM_FG
const OUTPUT_LABEL_FG = GREEN_FG

const NODE_LABEL: Record<MessageFrameKind, string> = {
  call: "",
  output: "",
  summary: "summary",
  attachment: "attached",
  workflow: "workflow",
}

export type MessageFrameKind = "call" | "output" | "summary" | "attachment" | "workflow"

export const MessageFrameKindContext = createContext<MessageFrameKind | undefined>(undefined)

type MessageFrameProps = {
  title: string
  subtitle?: string
  children: ReactNode
  maxHeight?: number
  width?: `${number}%` | number | "auto"
}

// A dim title line over indented content; the content clips at maxHeight until expanded.
export const MessageFrame = ({
  title,
  subtitle,
  children,
  maxHeight = MESSAGE_FRAME_MAX_HEIGHT,
  width = "100%" as const,
}: MessageFrameProps) => {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const kind = useContext(MessageFrameKindContext)

  const accent = kind === "call"
    ? CALL_LABEL_FG
    : kind === "output"
      ? OUTPUT_LABEL_FG
      : kind === "summary"
        ? SUMMARY_BORDER_COLOR
        : kind === "attachment"
          ? USER_INPUT_BORDER_COLOR
          : kind === "workflow"
            ? WORKFLOW_BORDER_COLOR
            : AGENT_BORDER_COLOR
  const label = kind && NODE_LABEL[kind] ? `${NODE_LABEL[kind]} ` : ""

  return (
    <box flexDirection="column" flexShrink={0} width={width} marginBottom={1}>
      <text selectable={false}>
        <span fg={accent}>{`~ ${label}${title}`}</span>
        {subtitle ? <span fg={MUTED_FG}>{` · ${subtitle}`}</span> : null}
      </text>
      <box
        width="100%"
        paddingLeft={2}
        maxHeight={expanded ? undefined : maxHeight}
        overflow={expanded ? undefined : "hidden"}
      >
        <box
          width="100%"
          flexShrink={0}
          onSizeChange={function (this: BoxRenderable) {
            setOverflowing(this.height > maxHeight)
          }}
        >
          {children}
        </box>
      </box>
      {(overflowing || expanded) && (
        <box paddingLeft={2}>
          <ExpandableRow expanded={expanded} onToggle={() => setExpanded((value) => !value)}>
            <text fg={MUTED_FG} selectable={false}>{expanded ? "show less" : "show more"}</text>
          </ExpandableRow>
        </box>
      )}
    </box>
  )
}
