import type { Fl0wAuth } from '../../models/auth';
import type { JsonObject, SyncFilename } from '../../models/sync';

/** Keys whose values are maps of independent entries, merged per entry rather than replaced wholesale. */
const ENTRY_MAPS: Record<SyncFilename, readonly string[]> = {
  'config.json': [],
  'mcp.json': ['mcpServers'],
  'auth.json': ['mcp'],
};

/** Per-device settings: never pushed, and a pull never overwrites them. */
const LOCAL_ONLY: Record<SyncFilename, readonly string[]> = {
  'config.json': ['sync'],
  'mcp.json': [],
  'auth.json': [],
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asJsonObject = (value: unknown): JsonObject => (isObject(value) ? value : {});

/** The part of a file that is shared with fl0w-work. */
export function shareable(filename: SyncFilename, value: JsonObject): JsonObject {
  const obj = asJsonObject(value);
  const keys = LOCAL_ONLY[filename];
  if (!keys.length) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, canonical(value[k])]));
};

export const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Both sides hold a fl0w login: keep whichever token lives longer, so a pull never swaps in a dying session. */
const pickFl0wAuth = (local: unknown, remote: unknown) =>
  ((remote as Fl0wAuth | undefined)?.expiresAt ?? 0) > ((local as Fl0wAuth | undefined)?.expiresAt ?? 0) ? remote : local;

type Resolve = (key: string, local: unknown, remote: unknown) => unknown;

function mergeObjects(base: JsonObject, local: JsonObject, remote: JsonObject, resolve: Resolve, entryMaps: readonly string[] = []) {
  const merged: JsonObject = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const [b, l, r] = [base[key], local[key], remote[key]];
    let value: unknown;
    if (jsonEqual(l, r) || jsonEqual(r, b)) value = l;
    else if (jsonEqual(l, b)) value = r;
    else if (entryMaps.includes(key) && isObject(l) && isObject(r)) value = mergeObjects(isObject(b) ? b : {}, l, r, resolve);
    else value = resolve(key, l, r);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Three-way merge of one config file. A key changed on one side takes that side; a key changed on
 * both sides goes to `preferLocal` (the newer write), except auth.json's `fl0w` login, which keeps
 * the longer-lived token. A merged auth.json never drops the local login, so syncing can't sign out.
 * Local-only keys (config.json's `sync`) always keep the local value.
 */
export function mergeConfig(
  filename: SyncFilename,
  { base, local, remote, preferLocal }: { base?: JsonObject | null, local: JsonObject | null, remote: JsonObject | null, preferLocal: boolean },
): JsonObject {
  const resolve: Resolve = (key, l, r) => {
    if (filename === 'auth.json' && key === 'fl0w' && l && r) return pickFl0wAuth(l, r);
    return preferLocal ? l : r;
  };
  const merged = mergeObjects(
    shareable(filename, asJsonObject(base)),
    shareable(filename, asJsonObject(local)),
    shareable(filename, asJsonObject(remote)),
    resolve,
    ENTRY_MAPS[filename],
  );
  const localObj = asJsonObject(local);
  if (filename === 'auth.json' && localObj.fl0w && !merged.fl0w) merged.fl0w = localObj.fl0w;
  for (const key of LOCAL_ONLY[filename]) {
    if (localObj[key] !== undefined) merged[key] = localObj[key];
  }
  return merged;
}
