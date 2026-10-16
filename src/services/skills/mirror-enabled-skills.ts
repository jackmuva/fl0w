import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FL0W_SKILLS_DIR } from '../../constants';
import type { CapabilitySelection } from '../../models/agent';
import type { SkillSummary } from '../agent/hooks/front-load';
import { syncEnabledSkillsInBackground } from './sync-skills';

export const MIRROR_DEBOUNCE_MS = 400;

export type MirrorEnabledSkillsResult = {
  mirrored: string[];
  skipped: string[];
  missing: string[];
  errors: Array<{ name: string; error: string }>;
};

export const isUnderFl0wSkills = (skillDir: string): boolean => {
  const base = resolve(FL0W_SKILLS_DIR);
  const target = resolve(skillDir);
  return target === base || target.startsWith(`${base}/`);
};

const logMirrorResult = (result: MirrorEnabledSkillsResult): void => {
  for (const name of result.missing) {
    console.warn(`Enabled skill "${name}" was not found; skipping mirror to ~/.fl0w/skills.`);
  }
  for (const { name, error } of result.errors) {
    console.warn(`Failed to mirror skill "${name}" to ~/.fl0w/skills: ${error}`);
  }
};

/** Copies enabled skills into ~/.fl0w/skills for portability and future sync. */
export async function mirrorEnabledSkills(
  selection: CapabilitySelection,
  catalog: SkillSummary[],
): Promise<MirrorEnabledSkillsResult> {
  const byName = new Map(catalog.map((skill) => [skill.name, skill]));
  const result: MirrorEnabledSkillsResult = {
    mirrored: [],
    skipped: [],
    missing: [],
    errors: [],
  };

  if (selection.skills.length === 0) return result;

  await mkdir(FL0W_SKILLS_DIR, { recursive: true });

  for (const name of selection.skills) {
    const skill = byName.get(name);
    if (!skill) {
      result.missing.push(name);
      continue;
    }

    const skillDir = dirname(resolve(skill.path));
    if (isUnderFl0wSkills(skillDir)) {
      result.skipped.push(name);
      continue;
    }

    const dest = join(FL0W_SKILLS_DIR, basename(skillDir));

    try {
      await rm(dest, { recursive: true, force: true });
      await cp(skillDir, dest, { recursive: true, force: true });
      result.mirrored.push(name);
    } catch (error) {
      result.errors.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let queuedMirror: { selection: CapabilitySelection; catalog: SkillSummary[] } | null = null;
let mirrorQueue: Promise<void> = Promise.resolve();

const runQueuedMirror = (): Promise<void> => {
  const work = queuedMirror;
  queuedMirror = null;
  if (!work) return mirrorQueue;

  mirrorQueue = mirrorQueue.then(async () => {
    logMirrorResult(await mirrorEnabledSkills(work.selection, work.catalog));
    // upload from the fresh mirror, but outside this queue so a slow network never delays a flush
    void syncEnabledSkillsInBackground(work.selection, work.catalog);
  }).catch(() => { });
  return mirrorQueue;
};

/** Debounced background mirror so capability apply stays responsive. */
export function scheduleMirrorEnabledSkills(
  selection: CapabilitySelection,
  catalog: SkillSummary[],
): void {
  queuedMirror = { selection, catalog };
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runQueuedMirror();
  }, MIRROR_DEBOUNCE_MS);
  debounceTimer.unref?.();
}

/** Best-effort flush before shutdown; does not block the caller. */
export function flushPendingSkillMirrorsInBackground(): void {
  void flushPendingSkillMirrors();
}

/** Runs any pending debounced mirror immediately and waits for in-flight copies. */
export async function flushPendingSkillMirrors(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await runQueuedMirror();
  await mirrorQueue;
}
