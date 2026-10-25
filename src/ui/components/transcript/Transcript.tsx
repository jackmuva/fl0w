import { useMemo } from "react"
import type { Fl0wMessage, SubagentType } from "../../../models/agent"
import { fl0wMessage } from "../../../services/agent/utils/fl0w-message"
import type { PlanProgress } from "../../lib/format/message"
import { groupTranscript, isPhaseSubagent } from "../../lib/format/segments"
import { MessageContent } from "../primitives/MessageContent"
import { PlanProgressContext } from "../tools/PlanToolView"
import { PhaseFrame } from "./PhaseFrame"

type TranscriptProps = {
  messages: Fl0wMessage[]
  toolCallInputs: Map<string, { toolName: string; input: unknown }>
  planProgress: PlanProgress | undefined
  activePhase: SubagentType | null
  streamingText: string | null
}

export const Transcript = ({
  messages,
  toolCallInputs,
  planProgress,
  activePhase,
  streamingText,
}: TranscriptProps) => {
  const segments = useMemo(() => groupTranscript(messages), [messages])
  const trailing = segments[segments.length - 1]
  // A phase that has started but not yet finished a step still gets its header above the stream.
  const pendingPhase = isPhaseSubagent(activePhase)
    && !(trailing?.kind === "phase" && trailing.subagent === activePhase)
    ? activePhase
    : null

  return (
    <PlanProgressContext.Provider value={planProgress}>
      {segments.map((segment, index) => {
        if (segment.kind === "single") {
          return (
            <MessageContent
              key={segment.index}
              message={segment.message}
              toolCallInputs={toolCallInputs}
            />
          )
        }

        // Only the trailing segment of the phase that is still running stays expanded.
        const live = index === segments.length - 1 && segment.subagent === activePhase
        return (
          <PhaseFrame
            key={segment.startIndex}
            subagent={segment.subagent}
            messages={segment.messages}
            live={live}
            toolCallInputs={toolCallInputs}
          />
        )
      })}
      {pendingPhase && (
        <PhaseFrame subagent={pendingPhase} messages={[]} live={true} toolCallInputs={toolCallInputs} />
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
