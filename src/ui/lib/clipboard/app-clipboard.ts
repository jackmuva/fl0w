import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type ClipboardService,
  type CliRenderer,
} from "@opentui/core"

let clipboard: ClipboardService | null = null

export const initAppClipboard = (renderer: CliRenderer): ClipboardService => {
  if (clipboard) return clipboard
  clipboard = createClipboard({
    host: createHostClipboard(),
    terminal: createRendererClipboardAdapter(renderer),
  })
  return clipboard
}

export const getAppClipboard = (): ClipboardService | null => clipboard

export const disposeAppClipboard = async (): Promise<void> => {
  const current = clipboard
  clipboard = null
  if (current) await current.dispose()
}

export const writeSelectionText = async (
  service: ClipboardService,
  text: string,
): Promise<boolean> => {
  if (!text) return false
  try {
    const result = await service.writeText(text, { destination: "best-available" })
    return (
      result.host.status === "written"
      || result.terminal.status === "attempted"
    )
  } catch {
    return false
  }
}

export const copySelectedText = async (text: string): Promise<boolean> => {
  const service = getAppClipboard()
  if (!service) return false
  return writeSelectionText(service, text)
}
