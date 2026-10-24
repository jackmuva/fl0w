import { useKeyboard } from "@opentui/react"
import type { KeyEvent } from "@opentui/core"
import { useMemo, useState } from "react"
import type {
  CapabilityCatalog,
  CapabilityKind,
  CapabilitySelection,
} from "../../../models/agent"
import { getFilterKeyAction } from "../../lib/dialog-filter-key"
import { filterByFuzzyName } from "../../lib/input-completion/fuzzy-match"
import { AGENT_BORDER_COLOR } from "../primitives/MessageFrame"
import type { ModelMetadata, ModelSelection } from "../../../models/ai-model"

const DIALOG_WIDTH = 64
const DIALOG_PADDING = 2
const DIALOG_BORDER = 2
const MAX_VISIBLE_ROWS = 14
const POPUP_WIDTH = 44
const CAPABILITY_INSTRUCTIONS = [
  "Type to filter",
  "←/→ tabs",
  "↑/↓ navigate",
  "Space toggle",
  "Ctrl+A select all",
  "Enter apply",
]
const MODEL_INSTRUCTIONS = [
  "Type to filter",
  "←/→ tabs",
  "↑/↓ navigate",
  "Space assign phases",
  "Enter apply",
]
const POPUP_INSTRUCTIONS = "Space toggle · Enter apply · Esc cancel"
const INSTRUCTION_SEPARATOR = " · "
const ACCENT_FG = "#e6d5b8"
const TEXT_FG = "#c0caf5"
const MUTED_FG = "#565f89"
const HIGHLIGHT_BG = "#283457"
const DONE_FG = "#9ece6a"

type TabKind = "models" | CapabilityKind
type Phase = keyof ModelSelection
type ModelAssignments = Record<Phase, string | null>

const TABS: Array<{ kind: TabKind, label: string }> = [
  { kind: "models", label: "Models" },
  { kind: "mcpServers", label: "MCP" },
  { kind: "skills", label: "Skills" },
  { kind: "userTools", label: "Tools" },
  { kind: "agentsMd", label: "AGENTS.md" },
]

const MODEL_PHASES: Array<{ phase: Phase, label: string, short: string }> = [
  { phase: "ROUTER", label: "Router agent", short: "Router" },
  { phase: "DISCOVERY", label: "Discovery subagent", short: "Discovery" },
  { phase: "PLAN", label: "Workflow plan agent", short: "Plan" },
  { phase: "EXECUTE", label: "Execution agent", short: "Execute" },
  { phase: "SUMMARIZE", label: "Compaction summary", short: "Summarize" },
]

const EMPTY_MESSAGES: Record<TabKind, string> = {
  models: "No models available",
  mcpServers: "No MCP tools available",
  skills: "No skills discovered",
  userTools: "No user tools found",
  agentsMd: "No AGENTS.md in this workspace",
}

type Row =
  | { type: "selectAll" }
  | { type: "item", name: string, description?: string }
  | { type: "model", name: string }

type PhasePopup = {
  model: string
  checked: Set<Phase>
  cursor: number
}

type ConfigDialogProps = {
  catalog: CapabilityCatalog
  models: ModelMetadata[]
  initialSelection: CapabilitySelection
  initialModels: ModelSelection | null
  onConfirm: (selection: { capabilities: CapabilitySelection, models: ModelSelection }) => void
  onDismiss: () => void
  terminalWidth: number
  terminalHeight: number
}

const truncate = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

const layoutInstructions = (segments: string[], width: number) => {
  const lines: string[] = []
  let current = ""
  for (const segment of segments) {
    const candidate = current ? `${current}${INSTRUCTION_SEPARATOR}${segment}` : segment
    if (current && candidate.length > width) {
      lines.push(current)
      current = segment
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.map((line) => truncate(line, width))
}

const toSets = (selection: CapabilitySelection) => ({
  skills: new Set(selection.skills),
  mcpServers: new Set(selection.mcpServers),
  userTools: new Set(selection.userTools),
  agentsMd: new Set(selection.agentsMd),
})

const toAssignments = (
  models: ModelMetadata[],
  initialModels: ModelSelection | null,
): ModelAssignments => {
  const fallback = models[0]?.model ?? null
  return {
    ROUTER: initialModels?.ROUTER ?? fallback,
    DISCOVERY: initialModels?.DISCOVERY ?? fallback,
    PLAN: initialModels?.PLAN ?? fallback,
    EXECUTE: initialModels?.EXECUTE ?? fallback,
    SUMMARIZE: initialModels?.SUMMARIZE ?? fallback,
  }
}

const isConfirmKey = (key: KeyEvent) => key.name === "return" || key.name === "kpenter"

export const ConfigDialog = ({
  catalog,
  models,
  initialSelection,
  initialModels,
  onConfirm,
  onDismiss,
  terminalWidth,
  terminalHeight,
}: ConfigDialogProps) => {
  const visibleTabs = useMemo(
    () => TABS.filter(({ kind }) =>
      kind === "models" ? models.length > 0 : catalog[kind].length > 0),
    [catalog, models],
  )
  const [enabled, setEnabled] = useState(() => toSets(initialSelection))
  const [modelAssignments, setModelAssignments] = useState(() =>
    toAssignments(models, initialModels))
  const [phasePopup, setPhasePopup] = useState<PhasePopup | null>(null)
  const [tabIndex, setTabIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [filterQuery, setFilterQuery] = useState("")
  const activeTab = visibleTabs[tabIndex] ?? visibleTabs[0]
  const activeKind: TabKind = activeTab?.kind ?? "skills"
  const capabilityKind = activeKind === "models" ? null : activeKind
  const modelItems = useMemo(() => models.map((entry) => ({ name: entry.model })), [models])
  const activeItems: Array<{ name: string, description?: string }> =
    capabilityKind ? catalog[capabilityKind] : modelItems
  const filteredItems = useMemo(
    () => filterByFuzzyName(activeItems, filterQuery),
    [activeItems, filterQuery],
  )

  const rows = useMemo<Row[]>(() => {
    if (filteredItems.length === 0) return []
    if (!capabilityKind) {
      return filteredItems.map((entry) => ({ type: "model" as const, name: entry.name }))
    }
    return [
      { type: "selectAll" },
      ...filteredItems.map((entry) => ({
        type: "item" as const,
        name: entry.name,
        description: entry.description,
      })),
    ]
  }, [capabilityKind, filteredItems])

  const enabledSet = capabilityKind ? enabled[capabilityKind] : null
  const enabledInTab = enabledSet
    ? activeItems.filter((entry) => enabledSet.has(entry.name)).length
    : 0
  const enabledInFilter = enabledSet
    ? filteredItems.filter((entry) => enabledSet.has(entry.name)).length
    : 0
  const allSelectedInTab =
    filteredItems.length > 0 && enabledInFilter === filteredItems.length
  const assignedPhaseCount = MODEL_PHASES.filter(({ phase }) => modelAssignments[phase] !== null).length

  const assignedPhases = (model: string) =>
    MODEL_PHASES.filter(({ phase }) => modelAssignments[phase] === model)

  const setAllInTab = (value: boolean) => {
    if (!capabilityKind) return
    setEnabled((previous) => {
      const next = new Set(previous[capabilityKind])
      for (const entry of filteredItems) {
        if (value) next.add(entry.name)
        else next.delete(entry.name)
      }
      return { ...previous, [capabilityKind]: next }
    })
  }

  const toggleRow = (row: Row | undefined) => {
    if (!row) return
    if (row.type === "model") {
      setPhasePopup({
        model: row.name,
        checked: new Set(assignedPhases(row.name).map(({ phase }) => phase)),
        cursor: 0,
      })
      return
    }
    if (row.type === "selectAll") {
      setAllInTab(!allSelectedInTab)
      return
    }
    if (!capabilityKind) return
    setEnabled((previous) => {
      const next = new Set(previous[capabilityKind])
      if (next.has(row.name)) next.delete(row.name)
      else next.add(row.name)
      return { ...previous, [capabilityKind]: next }
    })
  }

  // Popup row 0 is "Select all"; rows 1..n map to MODEL_PHASES.
  const togglePopupRow = (popup: PhasePopup): PhasePopup => {
    const checked = new Set(popup.checked)
    const phase = MODEL_PHASES[popup.cursor - 1]?.phase
    if (phase) {
      if (checked.has(phase)) checked.delete(phase)
      else checked.add(phase)
    } else if (checked.size === MODEL_PHASES.length) {
      checked.clear()
    } else {
      for (const entry of MODEL_PHASES) checked.add(entry.phase)
    }
    return { ...popup, checked }
  }

  // Each phase holds one model, so checking a phase takes it from whichever model had it.
  const commitPhasePopup = (popup: PhasePopup) => {
    setModelAssignments((previous) => {
      const next = { ...previous }
      for (const { phase } of MODEL_PHASES) {
        if (popup.checked.has(phase)) next[phase] = popup.model
        else if (next[phase] === popup.model) next[phase] = null
      }
      return next
    })
    setPhasePopup(null)
  }

  const handlePopupKey = (key: KeyEvent, popup: PhasePopup) => {
    const rowCount = MODEL_PHASES.length + 1
    if (key.name === "up") {
      setPhasePopup({ ...popup, cursor: (popup.cursor - 1 + rowCount) % rowCount })
    } else if (key.name === "down") {
      setPhasePopup({ ...popup, cursor: (popup.cursor + 1) % rowCount })
    } else if (key.name === "space") {
      setPhasePopup(togglePopupRow(popup))
    } else if (isConfirmKey(key)) {
      commitPhasePopup(popup)
    } else if (key.name === "escape") {
      setPhasePopup(null)
    }
  }

  const goToTab = (index: number) => {
    const next = ((index % visibleTabs.length) + visibleTabs.length) % visibleTabs.length
    setTabIndex(next)
    setFilterQuery("")
    setCursor(0)
  }

  const applyFilterKey = (action: NonNullable<ReturnType<typeof getFilterKeyAction>>) => {
    if (action.type === "backspace") {
      setFilterQuery((query) => query.slice(0, -1))
    } else {
      setFilterQuery((query) => query + action.char)
    }
    setCursor(0)
  }

  const buildSelection = (): CapabilitySelection => ({
    skills: catalog.skills.map((entry) => entry.name).filter((name) => enabled.skills.has(name)),
    mcpServers: catalog.mcpServers.map((entry) => entry.name).filter((name) => enabled.mcpServers.has(name)),
    userTools: catalog.userTools.map((entry) => entry.name).filter((name) => enabled.userTools.has(name)),
    agentsMd: catalog.agentsMd.map((entry) => entry.name).filter((name) => enabled.agentsMd.has(name)),
  })

  const buildModels = (): ModelSelection => {
    const fallback = models[0]?.model ?? ""
    return {
      ROUTER: modelAssignments.ROUTER ?? fallback,
      DISCOVERY: modelAssignments.DISCOVERY ?? fallback,
      PLAN: modelAssignments.PLAN ?? fallback,
      EXECUTE: modelAssignments.EXECUTE ?? fallback,
      SUMMARIZE: modelAssignments.SUMMARIZE ?? fallback,
    }
  }

  const confirm = () => onConfirm({ capabilities: buildSelection(), models: buildModels() })

  useKeyboard((key) => {
    if (visibleTabs.length === 0) {
      if (isConfirmKey(key)) {
        onDismiss()
      }
      return
    }

    if (phasePopup) {
      handlePopupKey(key, phasePopup)
      return
    }

    if (key.name === "left" && visibleTabs.length > 1) {
      goToTab(tabIndex - 1)
      return
    }

    if (key.name === "right" && visibleTabs.length > 1) {
      goToTab(tabIndex + 1)
      return
    }

    const filterKey = getFilterKeyAction(key)
    if (filterKey) {
      applyFilterKey(filterKey)
      return
    }

    if (rows.length === 0) {
      if (isConfirmKey(key)) {
        confirm()
      }
      return
    }

    if (key.name === "up") {
      setCursor((index) => (index - 1 + rows.length) % rows.length)
    } else if (key.name === "down") {
      setCursor((index) => (index + 1) % rows.length)
    } else if (key.name === "space") {
      toggleRow(rows[cursor])
    } else if (key.ctrl && key.name === "a") {
      setAllInTab(!allSelectedInTab)
    } else if (isConfirmKey(key)) {
      confirm()
    }
  })

  const totalEnabled =
    enabled.skills.size
    + enabled.mcpServers.size
    + enabled.userTools.size
    + enabled.agentsMd.size
  const totalItems =
    catalog.skills.length
    + catalog.mcpServers.length
    + catalog.userTools.length
    + catalog.agentsMd.length

  const dialogWidth = Math.min(DIALOG_WIDTH, Math.max(28, terminalWidth - 4))
  const innerWidth = dialogWidth - DIALOG_BORDER - DIALOG_PADDING
  const instructionLines = layoutInstructions(
    capabilityKind ? CAPABILITY_INSTRUCTIONS : MODEL_INSTRUCTIONS,
    innerWidth,
  )
  // title + totals + (margin + tabs) + (margin + tab totals)? + (margin + filter)? + (margin + instructions) + list margin
  const headerLines =
    1
    + 1
    + 2
    + (activeItems.length > 0 ? 2 : 0)
    + (activeItems.length > 0 ? 2 : 0)
    + 1 + instructionLines.length
    + 1
  const chromeLines = headerLines + DIALOG_PADDING + DIALOG_BORDER
  const listHeight = Math.max(
    1,
    Math.min(MAX_VISIBLE_ROWS, Math.max(rows.length, 1), terminalHeight - 2 - chromeLines),
  )
  const dialogHeight = listHeight + chromeLines
  const top = Math.max(1, Math.floor((terminalHeight - dialogHeight) / 2))
  const left = Math.max(1, Math.floor((terminalWidth - dialogWidth) / 2))

  const scrollStart = Math.min(
    Math.max(0, rows.length - listHeight),
    Math.max(0, cursor - Math.floor(listHeight / 2)),
  )
  const visibleRows = rows.slice(scrollStart, scrollStart + listHeight)

  const tabSummary = !capabilityKind
    ? `${assignedPhaseCount} of ${MODEL_PHASES.length} phases assigned`
    : filterQuery.length > 0
      ? `${enabledInFilter} of ${filteredItems.length} shown · ${enabledInTab} of ${activeItems.length} enabled in ${activeTab?.label ?? "tab"}`
      : `${enabledInTab} of ${activeItems.length} enabled in ${activeTab?.label ?? "tab"}`

  const popupWidth = Math.min(POPUP_WIDTH, dialogWidth - 4)
  const popupInnerWidth = popupWidth - DIALOG_BORDER - DIALOG_PADDING
  // title + margin + (select all + phases) + margin + instructions
  const popupHeight = 1 + 1 + (MODEL_PHASES.length + 1) + 1 + 1 + DIALOG_PADDING + DIALOG_BORDER
  const popupTop = Math.max(1, top + Math.floor((dialogHeight - popupHeight) / 2))
  const popupLeft = Math.max(1, left + Math.floor((dialogWidth - popupWidth) / 2))

  return (
    <>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={5}
        backgroundColor="#000000"
        opacity={0.45}
      />
      <box
        position="absolute"
        top={top}
        left={left}
        width={dialogWidth}
        height={dialogHeight}
        zIndex={10}
        border={true}
        borderColor={AGENT_BORDER_COLOR}
        backgroundColor="#1a1b26"
        flexDirection="column"
        padding={1}
      >
        <box flexDirection="row" justifyContent="space-between" width="100%" flexShrink={0}>
          <text fg={AGENT_BORDER_COLOR}>Configure session</text>
          {visibleTabs.length > 1 && (
            <text fg={MUTED_FG}>{`${tabIndex + 1}/${visibleTabs.length}`}</text>
          )}
        </box>
        <text fg={MUTED_FG} flexShrink={0}>{`${totalEnabled} of ${totalItems} enabled`}</text>

        <box flexDirection="row" width="100%" flexShrink={0} marginTop={1}>
          {visibleTabs.map((tab, index) => {
            const active = index === tabIndex
            let complete: boolean
            if (tab.kind === "models") {
              complete = assignedPhaseCount === MODEL_PHASES.length
            } else {
              const tabKind = tab.kind
              const count = catalog[tabKind].length
              const selected = catalog[tabKind].filter((entry) => enabled[tabKind].has(entry.name)).length
              complete = count > 0 && selected === count
            }
            return (
              <text key={tab.kind} fg={active ? ACCENT_FG : MUTED_FG} marginRight={1}>
                {complete && !active ? <span fg={DONE_FG}>✓ </span> : null}
                {active ? "❯ " : "  "}
                {tab.label}
              </text>
            )
          })}
        </box>

        {activeItems.length > 0 && (
          <text fg={MUTED_FG} flexShrink={0} marginTop={1}>
            {tabSummary}
          </text>
        )}

        {activeItems.length > 0 && (
          <text fg={filterQuery.length > 0 ? TEXT_FG : MUTED_FG} flexShrink={0} marginTop={1}>
            {truncate(
              filterQuery.length > 0 ? `Filter: ${filterQuery}` : "Filter: (type to search)",
              innerWidth,
            )}
          </text>
        )}

        <box flexDirection="column" width="100%" flexShrink={0} marginTop={1}>
          {instructionLines.map((line, index) => (
            <text key={`instructions-${index}`} fg={MUTED_FG} flexShrink={0} wrapMode="none">
              {line}
            </text>
          ))}
        </box>

        <box
          flexDirection="column"
          width="100%"
          height={listHeight}
          flexShrink={0}
          marginTop={1}
          overflow="hidden"
        >
          {rows.length === 0 ? (
            <text fg={MUTED_FG} flexShrink={0} wrapMode="none">
              {truncate(
                activeItems.length === 0
                  ? EMPTY_MESSAGES[activeKind]
                  : "No matches for filter",
                innerWidth,
              )}
            </text>
          ) : (
            visibleRows.map((row, offset) => {
              const index = scrollStart + offset
              const highlighted = index === cursor
              if (row.type === "model") {
                const phases = assignedPhases(row.name).map(({ short }) => short).join(INSTRUCTION_SEPARATOR)
                const prefix = `${highlighted ? "❯" : " "} `
                const nameWidth = Math.max(1, innerWidth - prefix.length - (phases ? phases.length + 1 : 0))
                const name = `${prefix}${truncate(row.name, nameWidth)}`
                return (
                  <text
                    key={`${activeKind}-${index}`}
                    fg={highlighted || phases ? TEXT_FG : MUTED_FG}
                    bg={highlighted ? HIGHLIGHT_BG : undefined}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    {name.padEnd(Math.max(name.length, innerWidth - phases.length))}
                    <span fg={DONE_FG}>{truncate(phases, Math.max(0, innerWidth - name.length))}</span>
                  </text>
                )
              }
              const checked = row.type === "selectAll"
                ? allSelectedInTab
                : enabledSet?.has(row.name) ?? false
              const label = row.type === "selectAll" ? "Select all" : row.name
              const prefix = `${highlighted ? "❯" : " "} [${checked ? "x" : " "}] `
              const detail = row.type === "item" && row.description
                ? ` — ${row.description.replace(/\s+/g, " ")}`
                : ""
              const line = truncate(`${prefix}${label}${detail}`, innerWidth)
              return (
                <text
                  key={`${activeKind}-${index}`}
                  fg={highlighted ? TEXT_FG : row.type === "selectAll" ? TEXT_FG : MUTED_FG}
                  bg={highlighted ? HIGHLIGHT_BG : undefined}
                  flexShrink={0}
                  wrapMode="none"
                >
                  {line}
                </text>
              )
            })
          )}
        </box>
      </box>
      {phasePopup && (
        <box
          position="absolute"
          top={popupTop}
          left={popupLeft}
          width={popupWidth}
          height={popupHeight}
          zIndex={20}
          border={true}
          borderColor={ACCENT_FG}
          backgroundColor="#1a1b26"
          flexDirection="column"
          padding={1}
        >
          <text fg={ACCENT_FG} flexShrink={0} wrapMode="none">
            {truncate(`Assign ${phasePopup.model}`, popupInnerWidth)}
          </text>
          <box flexDirection="column" width="100%" flexShrink={0} marginTop={1}>
            {[
              { label: "Select all", checked: phasePopup.checked.size === MODEL_PHASES.length },
              ...MODEL_PHASES.map(({ phase, label }) => ({
                label,
                checked: phasePopup.checked.has(phase),
              })),
            ].map((option, index) => {
              const highlighted = index === phasePopup.cursor
              return (
                <text
                  key={`phase-${index}`}
                  fg={highlighted || index === 0 ? TEXT_FG : MUTED_FG}
                  bg={highlighted ? HIGHLIGHT_BG : undefined}
                  flexShrink={0}
                  wrapMode="none"
                >
                  {truncate(
                    `${highlighted ? "❯" : " "} [${option.checked ? "x" : " "}] ${option.label}`,
                    popupInnerWidth,
                  )}
                </text>
              )
            })}
          </box>
          <text fg={MUTED_FG} flexShrink={0} marginTop={1} wrapMode="none">
            {truncate(POPUP_INSTRUCTIONS, popupInnerWidth)}
          </text>
        </box>
      )}
    </>
  )
}
