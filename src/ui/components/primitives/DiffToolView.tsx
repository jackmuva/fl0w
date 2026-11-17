import { syntaxStyle } from "../../lib/syntax-style"
import type { ToolViewProps } from "../../../models/ui"
import { MessageFrame } from "./MessageFrame"
import { theme } from "../../theme"

type DiffToolViewProps = ToolViewProps & {
  diff: string
  filetype?: string
  subtitle?: string
}

export const DiffToolView = ({
  toolName,
  diff,
  filetype,
  subtitle,
  text,
  isError,
}: DiffToolViewProps) => (
  <MessageFrame title={toolName} subtitle={subtitle ?? (isError ? undefined : text.split("\n")[0])}>
    {isError ? (
      <text fg={theme.error}>{text}</text>
    ) : (
      <diff
        diff={diff}
        view="unified"
        syntaxStyle={syntaxStyle}
        filetype={filetype}
        showLineNumbers={true}
        fg={theme.ink}
        lineNumberFg={theme.faint}
        addedBg={theme.addedBg}
        removedBg={theme.removedBg}
        addedSignColor={theme.moss}
        removedSignColor={theme.error}
        wrapMode="word"
      />
    )}
  </MessageFrame>
)
