// E-reader palette: greyscale e-ink paper and obsidian ink, with fl0w-work's
// moss/olive green and clay orange kept for status accents.
export const theme = {
  // Surfaces: e-ink paper with a faint warm cast
  paper: "#efede6", // the page
  paperRaised: "#f7f6f2", // dialogs, sheets lifted toward the light
  paperDeep: "#e4e2db", // the writing well (chat input)
  hover: "#e0ded6", // pencil wash on hover
  highlight: "#d8d6ce", // grey selection, like an e-ink invert
  stone: "#bdb9b0", // mid grey (mascot body)
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

export const selectColors = {
  backgroundColor: theme.paperRaised,
  focusedBackgroundColor: theme.paperRaised,
  textColor: theme.ink,
  focusedTextColor: theme.ink,
  selectedBackgroundColor: theme.highlight,
  selectedTextColor: theme.ink,
  descriptionColor: theme.muted,
  selectedDescriptionColor: theme.inkSoft,
} as const

export const textareaColors = {
  textColor: theme.ink,
  focusedTextColor: theme.ink,
  backgroundColor: theme.paperDeep,
  focusedBackgroundColor: theme.paperDeep,
  placeholderColor: theme.placeholder,
  cursorColor: theme.clay,
} as const

// Widest line of transcript text, like the measure of a printed page.
export const READING_WIDTH = 92
