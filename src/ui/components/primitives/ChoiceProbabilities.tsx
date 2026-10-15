import type { ChoiceProbabilities as Probabilities } from "../../../models/agent"
import { EDGE_FG, WorkflowEdge } from "./WorkflowEdge"

const MAX_CHOICES = 5
const BAR_WIDTH = 16
const MUTED_FG = "#565f89"
const SELECTED_FG = "#9ece6a"
const DECISION_FG = "#ff9e64"

type ChoiceProbabilitiesProps = {
  probabilities: Probabilities
  selected: string
}

const bar = (probability: number) => {
  const filled = Math.round(probability * BAR_WIDTH)
  return { filled: "█".repeat(filled), empty: "░".repeat(BAR_WIDTH - filled) }
}

export const ChoiceProbabilities = ({ probabilities, selected }: ChoiceProbabilitiesProps) => {
  const ranked = Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_CHOICES)
  const labelWidth = Math.max(...ranked.map(([choice]) => choice.length))

  return (
    <box width="75%" flexDirection="column" flexShrink={0}>
      <WorkflowEdge />
      <text>
        <span fg={DECISION_FG}>{"◆ DECISION"}</span>
        <span fg={MUTED_FG}>{` · ${ranked.length} branches`}</span>
      </text>
      {ranked.map(([choice, probability], index) => {
        const isSelected = choice === selected
        const branch = index === ranked.length - 1 ? "  └─" : "  ├─"
        const { filled, empty } = bar(probability)
        const fg = isSelected ? SELECTED_FG : MUTED_FG

        return (
          <text key={choice}>
            <span fg={EDGE_FG}>{branch}</span>
            <span fg={fg}>{`${isSelected ? "●" : "○"} ${choice.padEnd(labelWidth)}  `}</span>
            <span fg={fg}>{filled}</span>
            <span fg={EDGE_FG}>{empty}</span>
            <span fg={fg}>{` ${(probability * 100).toFixed(1).padStart(5)}%`}</span>
          </text>
        )
      })}
    </box>
  )
}
