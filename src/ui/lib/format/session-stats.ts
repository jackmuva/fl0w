export const formatSessionCostUsd = (usd: number): string => {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00"
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

export const formatSessionTokens = (tokens: number): string => {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0 tok"
  if (tokens < 10_000) return `${tokens.toLocaleString("en-US")} tok`
  if (tokens < 1_000_000) {
    const compact = tokens / 1000
    return `${compact >= 100 ? Math.round(compact) : compact.toFixed(1)}k tok`
  }
  return `${(tokens / 1_000_000).toFixed(2)}M tok`
}
