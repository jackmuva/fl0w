import { chmod, readFile, stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { SECRETS_PATH } from '../../constants';
import type { SecretEntry, SecretsFile } from '../../models/secrets';
import { writeJsonAtomic } from '../service-utils';

const RESERVED_KEYS = new Set(['description', 'domains', 'env']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Shorter values would mask ordinary words in tool output. */
const MIN_REDACT_LENGTH = 4;

export const SECRET_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export const secretFields = (entry: SecretEntry): [string, string][] =>
  Object.entries(entry).filter((pair): pair is [string, string] => !RESERVED_KEYS.has(pair[0]) && typeof pair[1] === 'string');

export const secretEnvName = (name: string, field: string) =>
  `FL0W_SECRET_${name}_${field}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

export const readSecrets = async (path = SECRETS_PATH): Promise<SecretsFile> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  if (platform() !== 'win32' && (await stat(path)).mode & 0o077) await chmod(path, 0o600).catch(() => undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${path} must be a JSON object of named secrets`);
  return parsed as SecretsFile;
};

export const writeSecrets = (secrets: SecretsFile, path = SECRETS_PATH) => writeJsonAtomic(path, secrets);

const normalizeDomain = (domain: string) =>
  domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0]!.replace(/^\*\./, '');

/** Resolves `<name>.<field>` to its value for a browser fill on `pageUrl`, enforcing the secret's allowed domains. */
export const resolveSecretRef = (secrets: SecretsFile, ref: string, pageUrl: string): string => {
  const dot = ref.lastIndexOf('.');
  const name = dot > 0 ? ref.slice(0, dot) : ref;
  const field = dot > 0 ? ref.slice(dot + 1) : '';
  const entry = secrets[name];
  if (!entry) throw new Error(`Unknown secret "${name}". Call list_secrets to see the secrets the user has made available.`);
  const fields = secretFields(entry);
  const value = fields.find(([key]) => key === field)?.[1];
  if (value === undefined) {
    throw new Error(`Secret "${name}" has no field "${field}". Use one of: ${fields.map(([key]) => `${name}.${key}`).join(', ')}`);
  }
  const domains = (entry.domains ?? []).map(normalizeDomain).filter(Boolean);
  if (domains.length === 0) {
    throw new Error(`Secret "${name}" has no allowed domains, so it can't be used in the browser. `
      + `Ask the user to allow a site for it (fl0w secrets add ${name} --domain <site>).`);
  }
  const { hostname, protocol } = new URL(pageUrl);
  if (!domains.some((domain) => domain === '*' || hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error(`Secret "${name}" may only be used on ${domains.join(', ')}; the current page is ${hostname || pageUrl}.`);
  }
  if (protocol !== 'https:' && !LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to fill secret "${name}" on an insecure ${protocol} page.`);
  }
  return value;
};

export const secretEnv = (secrets: SecretsFile): Record<string, string> => Object.fromEntries(
  Object.entries(secrets)
    .filter(([, entry]) => entry.env === true)
    .flatMap(([name, entry]) => secretFields(entry).map(([field, value]) => [secretEnvName(name, field), value])),
);

/** Returns a function that replaces every secret value inside strings, arrays, and plain objects with `[secret <name>.<field>]`. */
export const secretRedactor = (secrets: SecretsFile) => {
  const labels = new Map<string, string>();
  for (const [name, entry] of Object.entries(secrets)) {
    for (const [field, value] of secretFields(entry)) {
      if (value.length >= MIN_REDACT_LENGTH && !labels.has(value)) labels.set(value, `[secret ${name}.${field}]`);
    }
  }
  if (labels.size === 0) return <T>(value: T) => value;
  const pattern = new RegExp([...labels.keys()]
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'), 'g');
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(pattern, (match) => labels.get(match)!);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    }
    return value;
  };
  return <T>(value: T) => redact(value) as T;
};

/** Masks secret values in tool output before it reaches the model, transcript, or synced session. */
export const redactSecrets = async <T>(value: T): Promise<T> =>
  secretRedactor(await readSecrets().catch(() => ({})))(value);
