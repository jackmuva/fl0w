// Flo, the lil workflow generator. Each character is one pixel; frames are
// rendered two pixel-rows per terminal row with half blocks (see Fl0wMascot).
// Palette: B body · D shade · E eyes/mouth · W sparkle · P cheeks ·
//          Y antenna node · G workflow nodes · V arms/feet · . transparent

export const FL0W_MASCOT_WIDTH = 14

const PIXEL_COLORS: Record<string, string> = {
  B: "#7dcfff",
  D: "#7aa2f7",
  E: "#1a1b26",
  W: "#c0caf5",
  P: "#f7768e",
  Y: "#e0af68",
  G: "#9ece6a",
  V: "#bb9af7",
}

export const FL0W_MASCOT_IDLE: readonly string[] = [
  "......YY......",
  ".....BBBB.....",
  "....BBBBBB....",
  "..BBBBBBBBBB..",
  "..BBEEBBEEBB..",
  ".VBBEWBBEWBBV.",
  ".VBPBBBBEBPBV.",
  "..BBGBGBBGBB..",
  "...DDDDDDDD...",
  "...VV....VV...",
]

export const FL0W_MASCOT_BLINK: readonly string[] = [
  "......YY......",
  ".....BBBB.....",
  "....BBBBBB....",
  "..BBBBBBBBBB..",
  "..BBEEBBEEBB..",
  ".VBBBBBBBBBBV.",
  ".VBPBBBBEBPBV.",
  "..BBGBGBBGBB..",
  "...DDDDDDDD...",
  "...VV....VV...",
]

// Arms up + happy eyes, arms swing side to side, a wink, feet stepping apart
// and together. The component adds the bounce and the ♪ notes on top.
export const FL0W_MASCOT_DANCE_FRAMES: readonly (readonly string[])[] = [
  [
    "......YY......",
    ".....BBBB.....",
    "....BBBBBB....",
    ".VBBBBBBBBBBV.",
    ".VBBEEBBEEBBV.",
    "..BBBBBBBBBB..",
    "..BPBBBBEBPB..",
    "..BBGBGBBGBB..",
    "...DDDDDDDD...",
    "..VV......VV..",
  ],
  [
    "......YY......",
    ".....BBBB.....",
    "....BBBBBB....",
    ".VBBBBBBBBBB..",
    ".VBBEEBBEEBB..",
    "..BBEWBBEWBBV.",
    "..BPBBBBEBPBV.",
    "..BBGBGBBGBB..",
    "...DDDDDDDD...",
    "..VV.....VV...",
  ],
  [
    "......YY......",
    ".....BBBB.....",
    "....BBBBBB....",
    "..BBBBBBBBBB..",
    "..BBEEBBEEBB..",
    ".VBBBBBBEWBBV.",
    ".VBPBBBBEBPBV.",
    "..BBGBGBBGBB..",
    "...DDDDDDDD...",
    "..VV......VV..",
  ],
  [
    "......YY......",
    ".....BBBB.....",
    "....BBBBBB....",
    "..BBBBBBBBBBV.",
    "..BBEEBBEEBBV.",
    ".VBBEWBBEWBB..",
    ".VBPBBBBEBPB..",
    "..BBGBGBBGBB..",
    "...DDDDDDDD...",
    "...VV.....VV..",
  ],
]

export type PixelSpan = { text: string; fg?: string; bg?: string }

export const mascotFrameToSpans = (frame: readonly string[]): PixelSpan[][] => {
  const rows: PixelSpan[][] = []
  for (let y = 0; y < frame.length; y += 2) {
    const spans: PixelSpan[] = []
    for (let x = 0; x < FL0W_MASCOT_WIDTH; x++) {
      const top = PIXEL_COLORS[frame[y]?.[x] ?? "."]
      const bottom = PIXEL_COLORS[frame[y + 1]?.[x] ?? "."]
      const cell: PixelSpan = !top && !bottom
        ? { text: " " }
        : top && !bottom
          ? { text: "▀", fg: top }
          : !top && bottom
            ? { text: "▄", fg: bottom }
            : top === bottom
              ? { text: "█", fg: top }
              : { text: "▀", fg: top, bg: bottom }
      const last = spans[spans.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else spans.push(cell)
    }
    rows.push(spans)
  }
  return rows
}
