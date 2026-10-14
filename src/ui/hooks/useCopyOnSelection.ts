import { useSelectionHandler } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { copySelectedText } from "../lib/clipboard/app-clipboard"

const COPIED_VISIBLE_MS = 2000

export const useCopyOnSelection = () => {
  const [copiedVisible, setCopiedVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashCopied = useCallback(() => {
    setCopiedVisible(true)
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      setCopiedVisible(false)
      hideTimeoutRef.current = null
    }, COPIED_VISIBLE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    }
  }, [])

  useSelectionHandler((selection) => {
    const text = selection.getSelectedText()
    void copySelectedText(text).then((ok) => {
      if (ok) flashCopied()
    })
  })

  return copiedVisible
}
