export type ModelMetadata = {
  model: string,
  contextWindow: number,
  type: "text" | "decision",
}

export type ModelSelection = {
  "ROUTER": string,
  "DISCOVERY": string,
  "PLAN": string,
  "EXECUTE": string,
}
