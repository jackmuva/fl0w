import { PREFERENCES_PATH } from '../constants';
import type { CapabilitySelection, ModelSelection, Preferences } from '../models/agent';
import { parseCapabilitySelection, parseModelSelection, writeJsonAtomic } from '../services/service-utils';
import { configSyncStore } from '../services/sync/config-sync';

/** Each field is validated on its own, so one bad field doesn't discard the other. */
const parsePreferences = (raw: unknown): Preferences => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const { models, capabilities } = raw as Record<string, unknown>;
  const parsedModels = parseModelSelection(models);
  const parsedCapabilities = parseCapabilitySelection(capabilities);
  return {
    ...(parsedModels && { models: parsedModels }),
    ...(parsedCapabilities && { capabilities: parsedCapabilities }),
  };
};

/** Key order doesn't matter: the file may have been written by another device. */
const sameSelection = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every((key) => JSON.stringify(a?.[key]) === JSON.stringify(b?.[key]));
};

/**
 * The last `/configure` confirmation (`~/.fl0w/preferences.json`). New sessions start from it; explicit inputs (CLI
 * flags, a resumed session, a workflow) win over it. Synced through config sync, where the newer file wins.
 */
class PreferencesStore {
  private cache: Preferences = {};

  /** Call after the startup config sync, so preferences pulled from fl0w-work apply. */
  async load(path = PREFERENCES_PATH): Promise<void> {
    try {
      const file = Bun.file(path);
      this.cache = (await file.exists()) ? parsePreferences(await file.json()) : {};
    } catch {
      this.cache = {};
    }
  }

  models(): Partial<ModelSelection> {
    return { ...this.cache.models };
  }

  capabilities(): CapabilitySelection | null {
    return this.cache.capabilities ?? null;
  }

  /** The whole validated file, e.g. for `fl0w capabilities` to report to fl0w-work. */
  preferences(): Preferences {
    const { models, capabilities } = this.cache;
    return {
      ...(models && { models: { ...models } }),
      ...(capabilities && { capabilities }),
    };
  }

  /**
   * Never throws: failing to remember a choice must not break /configure. An unchanged choice isn't rewritten, so
   * headless turns that save every time don't push a new version each turn.
   */
  async save(next: { models: ModelSelection, capabilities: CapabilitySelection }, path = PREFERENCES_PATH): Promise<void> {
    if (sameSelection(this.cache.models, next.models) && sameSelection(this.cache.capabilities, next.capabilities)) return;
    this.cache = { models: { ...next.models }, capabilities: next.capabilities };
    try {
      await writeJsonAtomic(path, this.cache);
      configSyncStore.notifyLocalWrite(path);
    } catch (error) {
      console.error(`Could not save preferences to ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const preferencesStore = new PreferencesStore();
