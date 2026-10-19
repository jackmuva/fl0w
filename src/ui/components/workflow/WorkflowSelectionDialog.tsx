import type { SelectOption } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import type { WorkflowRecord } from "../../../models/workflow"
import { DeleteConfirmationDialog } from "../primitives/DeleteConfirmationDialog"
import { getFilterKeyAction } from "../../lib/dialog-filter-key"
import { filterByFuzzyName } from "../../lib/input-completion/fuzzy-match"
import { AGENT_BORDER_COLOR } from "../primitives/MessageFrame"

const MAX_VISIBLE_ITEMS = 6
const DIALOG_WIDTH = 56
const DIALOG_PADDING = 2
const DIALOG_BORDER = 2
const INSTRUCTIONS = "Type to filter · ↑/↓ to navigate · Enter to select · x to delete · Esc to dismiss"
const TEXT_FG = "#c0caf5"
const MUTED_FG = "#565f89"

type WorkflowSelectionDialogProps = {
  workflows: WorkflowRecord[]
  onSelect: (workflowId: string) => void
  onDelete?: (workflowId: string) => void
  onDismiss: () => void
  terminalWidth: number
  terminalHeight: number
}

const formatWorkflowLabel = (workflow: WorkflowRecord) =>
  workflow.title.trim() || "Untitled workflow"

const formatWorkflowDescription = (workflow: WorkflowRecord) => {
  const updated = new Date(workflow.updatedAt).toLocaleString()
  const stepCount = workflow.steps.length
  return `${stepCount} step${stepCount === 1 ? "" : "s"} · Updated ${updated}`
}

const truncate = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

export const WorkflowSelectionDialog = ({
  workflows,
  onSelect,
  onDelete,
  onDismiss,
  terminalWidth,
  terminalHeight,
}: WorkflowSelectionDialogProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterQuery, setFilterQuery] = useState("")
  const [pendingDelete, setPendingDelete] = useState<WorkflowRecord | null>(null)

  const filteredWorkflows = useMemo(() => {
    const entries = workflows.map((workflow) => ({
      name: formatWorkflowLabel(workflow),
      workflow,
    }))
    return filterByFuzzyName(entries, filterQuery).map((entry) => entry.workflow)
  }, [workflows, filterQuery])

  useEffect(() => {
    if (filteredWorkflows.length === 0) {
      setPendingDelete(null)
      return
    }
    setSelectedIndex((index) => Math.min(index, filteredWorkflows.length - 1))
  }, [filteredWorkflows.length])

  const applyFilterKey = (action: NonNullable<ReturnType<typeof getFilterKeyAction>>) => {
    if (action.type === "backspace") {
      setFilterQuery((query) => query.slice(0, -1))
    } else {
      setFilterQuery((query) => query + action.char)
    }
    setSelectedIndex(0)
  }

  useKeyboard((key) => {
    if (pendingDelete) return

    if (workflows.length === 0) {
      if (key.name === "escape" || key.name === "return" || key.name === "kpenter") {
        onDismiss()
      }
      return
    }

    if (filteredWorkflows.length === 0) {
      const filterKey = getFilterKeyAction(key)
      if (filterKey) {
        applyFilterKey(filterKey)
        return
      }
      if (key.name === "escape") {
        if (filterQuery.length > 0) {
          setFilterQuery("")
          setSelectedIndex(0)
        } else {
          onDismiss()
        }
      }
      return
    }

    if (key.name === "x" && onDelete) {
      const workflow = filteredWorkflows[selectedIndex]
      if (workflow) setPendingDelete(workflow)
      return
    }

    const filterKey = getFilterKeyAction(key)
    if (filterKey) {
      applyFilterKey(filterKey)
      return
    }

    if (key.name === "up") {
      setSelectedIndex((index) => (index - 1 + filteredWorkflows.length) % filteredWorkflows.length)
      return
    }

    if (key.name === "down") {
      setSelectedIndex((index) => (index + 1) % filteredWorkflows.length)
      return
    }

    if (key.name === "return" || key.name === "kpenter") {
      const workflow = filteredWorkflows[selectedIndex]
      if (workflow) onSelect(workflow.id)
      return
    }

    if (key.name === "escape") {
      if (filterQuery.length > 0) {
        setFilterQuery("")
        setSelectedIndex(0)
      } else {
        onDismiss()
      }
    }
  })

  const options: SelectOption[] = useMemo(
    () =>
      filteredWorkflows.map((workflow, index) => {
        const deleteHint = onDelete && index === selectedIndex ? " · x" : ""
        return {
          name: formatWorkflowLabel(workflow),
          description: `${formatWorkflowDescription(workflow)}${deleteHint}`,
          value: workflow.id,
        }
      }),
    [filteredWorkflows, onDelete, selectedIndex],
  )

  const dialogWidth = Math.min(DIALOG_WIDTH, Math.max(24, terminalWidth - 4))
  const innerWidth = dialogWidth - DIALOG_BORDER - DIALOG_PADDING
  const headerLines =
    1
    + (workflows.length > 0 ? 1 : 0)
    + (workflows.length > 0 ? 1 : 0)
    + Math.ceil(INSTRUCTIONS.length / innerWidth)
  const chromeLines = headerLines + DIALOG_PADDING + DIALOG_BORDER

  const linesPerItem = 2
  const maxListHeight = Math.max(linesPerItem, terminalHeight - 2 - chromeLines)
  const listHeight = Math.min(
    MAX_VISIBLE_ITEMS * linesPerItem,
    maxListHeight,
    Math.max(linesPerItem, options.length * linesPerItem),
  )
  const bodyHeight = workflows.length === 0 || filteredWorkflows.length === 0 ? 1 : listHeight
  const dialogHeight = bodyHeight + chromeLines
  const top = Math.max(1, Math.floor((terminalHeight - dialogHeight) / 2))
  const left = Math.max(1, Math.floor((terminalWidth - dialogWidth) / 2))

  const listBody = (() => {
    if (workflows.length === 0) {
      return <text fg={MUTED_FG} flexShrink={0}>No saved workflows</text>
    }
    if (filteredWorkflows.length === 0) {
      return <text fg={MUTED_FG} flexShrink={0}>No matches for filter</text>
    }
    return (
      <select
        options={options}
        selectedIndex={selectedIndex}
        showDescription={true}
        showSelectionIndicator={true}
        height={listHeight}
        width="100%"
        focused={false}
      />
    )
  })()

  const confirmDelete = () => {
    if (!pendingDelete || !onDelete) return
    const workflowId = pendingDelete.id
    onDelete(workflowId)
    queueMicrotask(() => setPendingDelete(null))
  }

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
        <text fg={AGENT_BORDER_COLOR} flexShrink={0}>Run workflow</text>
        {workflows.length > 0 && (
          <text fg={MUTED_FG} flexShrink={0}>
            {filterQuery.length > 0
              ? `${filteredWorkflows.length} of ${workflows.length} shown`
              : `${workflows.length} saved workflow${workflows.length === 1 ? "" : "s"}`}
          </text>
        )}
        {workflows.length > 0 && (
          <text fg={filterQuery.length > 0 ? TEXT_FG : MUTED_FG} flexShrink={0}>
            {truncate(
              filterQuery.length > 0 ? `Filter: ${filterQuery}` : "Filter: (type to search)",
              innerWidth,
            )}
          </text>
        )}
        <text fg={MUTED_FG} flexShrink={0}>{INSTRUCTIONS}</text>
        {listBody}
      </box>
      {pendingDelete && onDelete && (
        <DeleteConfirmationDialog
          title="Delete workflow?"
          message={`This permanently removes "${formatWorkflowLabel(pendingDelete)}".`}
          onConfirm={confirmDelete}
          onCancel={() => queueMicrotask(() => setPendingDelete(null))}
          terminalWidth={terminalWidth}
          terminalHeight={terminalHeight}
        />
      )}
    </>
  )
}
