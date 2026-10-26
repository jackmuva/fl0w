import { syntaxStyle } from "../../lib/syntax-style"

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
    fg="#565f89"
    minWidth={3}
    paddingRight={1}
    showLineNumbers={true}
    lineNumberOffset={startLine - 1}
    width="100%"
  >
    <code content={content} filetype={filetype} syntaxStyle={syntaxStyle} width="100%" />
  </line-number>
)
