/**
 * One named secret in `~/.fl0w/secrets.json`. Every string property other than the reserved
 * `description`, `domains`, and `env` is a secret field (e.g. `username`, `password`, `token`), referenced as `<name>.<field>`.
 */
export type SecretEntry = {
  description?: string,
  /** Sites (and their subdomains) where browser_fill may type this secret; `"*"` allows any site. */
  domains?: string[],
  /** Expose the fields to the bash tool as `FL0W_SECRET_<NAME>_<FIELD>` environment variables. */
  env?: boolean,
  [field: string]: string | string[] | boolean | undefined,
}

export type SecretsFile = Record<string, SecretEntry>
