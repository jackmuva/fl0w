export type ModelMetadata = {
  model: string,
  contextWindow: number,
  /** USD per 1M input tokens */
  inputTokenPrice: number,
  type: "text" | "decision",
}

export type ModelSelection = {
  "ROUTER": string,
  "DISCOVERY": string,
  "PLAN": string,
  "EXECUTE": string,
  "SUMMARIZE": string,
}
