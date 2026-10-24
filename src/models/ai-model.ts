export type ModelMetadata = {
  model: string,
  contextWindow: number,
  type: "text" | "decision",
}

export type ModelSelection = {
  "DISCOVERY": string,
  "PLAN": string,
  "EXECUTE": string,
}
