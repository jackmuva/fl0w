import { syntaxStyle } from "../../lib/syntax-style"
import { selectionColors, theme } from "../../theme"

type HighlightedCodeProps = {
  content: string
  filetype?: string
  startLine?: number
}

export const HighlightedCode = ({
  content,
  filetype = "plaintext",
  startLine = 1,
}: HighlightedCodeProps) => (
  <line-number
    fg={theme.muted}
    minWidth={3}
    paddingRight={1}
    showLineNumbers={true}
    lineNumberOffset={startLine - 1}
    width="100%"
  >
    <code {...selectionColors} content={content} filetype={filetype} syntaxStyle={syntaxStyle} fg={theme.ink} width="100%" />
  </line-number>
)
