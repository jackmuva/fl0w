/** A profile of the user's own Chrome install, read from its `Local State`. */
export type ChromeProfile = {
  directory: string,
  name: string,
  email?: string,
  userDataDir: string,
}

/** A persistent fl0w browser profile in `BROWSER_PROFILES_DIR/<name>`. */
export type BrowserProfile = {
  name: string,
  /** Profile folder inside the user data dir that Chrome is launched with. */
  directory: string,
  /** Set when the profile was imported from a Chrome profile. */
  importedFrom?: { name: string, directory: string, email?: string, importedAt: string },
}

export type BrowserTarget = {
  ref?: number,
  selector?: string,
  text?: string,
}

export type BrowserFillField = BrowserTarget & {
  value: string | boolean | string[],
}
