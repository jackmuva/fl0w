import { useEffect, useState } from "react"
import { theme } from "../../theme"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

type WorkingIndicatorProps = {
  label?: string
}

export const WorkingIndicator = ({ label = "WORKING" }: WorkingIndicatorProps) => {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(id)
  }, [])

  return <text fg={theme.ink}>{SPINNER_FRAMES[frame]} {label}</text>
}
