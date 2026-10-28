import type { JsonObject, SyncFilename } from '../../../models/sync';

const LOCAL_ONLY: Record<SyncFilename, readonly string[]> = {
  'mcp.json': [],
  'auth.json': ['fl0w'],
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asJsonObject = (value: unknown): JsonObject => (isObject(value) ? value : {});

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

export function mergeConfig(
  filename: SyncFilename,
  { base, local, remote, preferLocal }: { base?: JsonObject | null, local: JsonObject | null, remote: JsonObject | null, preferLocal: boolean },
): JsonObject {
  const [b, l, r] = [base, local, remote].map((value) => shareable(filename, asJsonObject(value)));
  const merged = { ...(jsonEqual(r, b) || (preferLocal && !jsonEqual(l, b)) ? l : r) };
  const localObj = asJsonObject(local);
  for (const key of LOCAL_ONLY[filename]) {
    if (localObj[key] !== undefined) merged[key] = localObj[key];
  }
  return merged;
}
