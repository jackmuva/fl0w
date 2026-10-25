import type { ToolViewProps } from "../../../models/ui"
import { MessageFrame } from "./MessageFrame"

type ListToolViewProps = ToolViewProps & {
  items: string[]
  subtitle?: string
  markers?: string[]
  markerColors?: (string | undefined)[]
}

export const ListToolView = ({
  toolName,
  items,
  subtitle,
  markers,
  markerColors,
  text,
  isError,
}: ListToolViewProps) => (
  <MessageFrame title={toolName} subtitle={subtitle}>
    {isError ? (
      <text fg="#f7768e">{text}</text>
    ) : (
      <>
        {items.map((item, index) => (
          <text key={index}>
            <span fg={markerColors?.[index]}>{markers?.[index] ?? "•"}</span> {item}
          </text>
        ))}
      </>
    )}
  </MessageFrame>
)
