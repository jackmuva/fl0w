import { RGBA } from "@opentui/core"

// E-reader palette: greyscale e-ink paper and obsidian ink, with fl0w-work's
// moss/olive green and clay orange kept for status accents.
export const theme = {
  // Surfaces: e-ink paper with a faint warm cast
  paper: "#efede6", // the page
  paperRaised: "#f7f6f2", // dialogs, sheets lifted toward the light
  paperDeep: "#e4e2db", // the writing well (chat input)
  hover: "#e0ded6", // pencil wash on hover
  highlight: "#4a4843", // dark graphite selection, like an e-ink invert
  shade: "#2a2a28", // shadow behind dialogs

  // Ink: greyscale ramp from obsidian down to pencil
  ink: "#1f2a24", // obsidian
  graphite: "#4a4843",
  inkSoft: "#5c5a55",
  muted: "#7c7a74",
  faint: "#a3a19a",
  edge: "#c9c6be", // ruled lines, connectors
  placeholder: "#9c9a93",

  // Accents, used sparingly for status
  moss: "#3f6b53",
  olive: "#6b7a2f",
  clay: "#b4643f",
  orange: "#c8702f",
  error: "#a8392c",
  errorSoft: "#9c6a62",
  addedBg: "#dfe4d8",
  removedBg: "#ead9d3",
} as const

// Perceived luminance (Rec. 601 weights); below half reads as dark.
export const isDarkColor = (color: string): boolean => {
  const { r, g, b } = RGBA.fromHex(color)
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5
}

// Text color that stays readable on a highlight/hover background: white when the
// background is dark (matching the textarea's native selection), else the given fg.
export const textOnBg = (bg: string, fg: string): string => (isDarkColor(bg) ? "#FFFFFF" : fg)

export const selectionColors = {
  selectionBg: theme.highlight,
  selectionFg: "#FFFFFF",
} as const

export const selectColors = {
  backgroundColor: theme.paperRaised,
  focusedBackgroundColor: theme.paperRaised,
  textColor: theme.ink,
  focusedTextColor: theme.ink,
  selectedBackgroundColor: theme.highlight,
  selectedTextColor: textOnBg(theme.highlight, theme.ink),
  descriptionColor: theme.muted,
  selectedDescriptionColor: textOnBg(theme.highlight, theme.inkSoft),
} as const

export const textareaColors = {
  ...selectionColors,
  textColor: theme.ink,
  focusedTextColor: theme.ink,
  backgroundColor: theme.paperDeep,
  focusedBackgroundColor: theme.paperDeep,
  placeholderColor: theme.placeholder,
  cursorColor: theme.clay,
} as const

export const READING_WIDTH = 92
