import { useMemo } from "react"
import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import { fl0wMessage } from "../../../services/agent/utils/message-utils"
import type { PlanProgress } from "../../lib/format/message"
import { groupTranscript, isPhaseSubagent, type TranscriptSegment } from "../../lib/format/segments"
import { MessageContent } from "../primitives/MessageContent"
import { PlanProgressContext } from "../tools/PlanToolView"
import { EntryView } from "./JournalEntry"
import { PhaseFrame } from "./PhaseFrame"

type TranscriptProps = {
  messages: Fl0wMessage[]
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
  planProgress: PlanProgress | undefined
  activePhase: SubagentType | null
  streamingText: string | null
}

const isUserTurnStart = (segment: TranscriptSegment): boolean =>
  segment.kind === "single" && segment.message.message.role === "user"

// Indices of the final phase segment within each agent turn (turns are delimited by user messages).
const lastPhasePerTurn = (segments: TranscriptSegment[]): Set<number> => {
  const indices = new Set<number>()
  let seenPhaseInTurn = false
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]!
    if (isUserTurnStart(segment)) {
      seenPhaseInTurn = false
    } else if (segment.kind === "phase" && !seenPhaseInTurn) {
      indices.add(index)
      seenPhaseInTurn = true
    }
  }
  return indices
}

export const Transcript = ({
  messages,
  toolCallInputs,
  planProgress,
  activePhase,
  streamingText,
}: TranscriptProps) => {
  const segments = useMemo(() => groupTranscript(messages), [messages])
  const lastPhaseIndices = useMemo(() => lastPhasePerTurn(segments), [segments])
  const trailing = segments[segments.length - 1]
  // A phase that has started but not yet finished a step still gets its header above the stream.
  const pendingPhase = isPhaseSubagent(activePhase)
    && !(trailing?.kind === "phase" && trailing.subagent === activePhase)
    ? activePhase
    : null

  return (
    <PlanProgressContext.Provider value={planProgress}>
      {segments.map((segment, index) => {
        if (segment.kind !== "phase") {
          return (
            <EntryView
              key={segment.kind === "burst" ? `b${segment.startIndex}` : segment.index}
              entry={segment}
              toolCallInputs={toolCallInputs}
            />
          )
        }

        const live = index === segments.length - 1 && segment.subagent === activePhase
        return (
          <PhaseFrame
            key={`p${segment.startIndex}`}
            subagent={segment.subagent}
            messages={segment.messages}
            live={live}
            latest={lastPhaseIndices.has(index)}
            toolCallInputs={toolCallInputs}
          />
        )
      })}
      {pendingPhase && (
        <PhaseFrame subagent={pendingPhase} messages={[]} live={true} latest={true} toolCallInputs={toolCallInputs} />
      )}
      {streamingText && (
        <MessageContent
          message={fl0wMessage({ role: "assistant", content: streamingText })}
          toolCallInputs={toolCallInputs}
        />
      )}
    </PlanProgressContext.Provider>
  )
}
