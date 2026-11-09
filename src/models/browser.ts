export type BrowserTarget = {
  ref?: number,
  selector?: string,
  text?: string,
}

export type BrowserFillField = BrowserTarget & {
  value?: string | boolean | string[],
  /** `<name>.<field>` from secrets.json, typed in place of `value` so the model never sees it. */
  secret?: string,
}
