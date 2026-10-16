import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FL0W_SKILLS_DIR } from '../../constants';
import type { CapabilitySelection } from '../../models/agent';
import type { SkillSummary } from '../agent/hooks/front-load';
import { readFl0wAuth } from '../auth/token';
import { isConfigSyncEnabled } from '../config/app-config';
import { listRemoteSkills, putSkillBundle } from '../sync/sync-api';
import { isUnderFl0wSkills } from './mirror-enabled-skills';

/** Matches fl0w-work's limit, which sits under Vercel's 4.5 MB request body cap. */
export const MAX_SKILL_BUNDLE_BYTES = 4 * 1024 * 1024;

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
// secrets a skill folder might carry locally that must never leave the machine
const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

const isIgnored = (name: string) => IGNORED_NAMES.has(name) || IGNORED_PATTERNS.some((p) => p.test(name));

export type PackedSkill = {
  /** sha256 over sorted paths + file bytes; stable across runs, unlike the tarball (which embeds mtimes). */
  contentHash: string;
  bundle: Uint8Array<ArrayBuffer>;
  files: string[];
};

async function listSkillFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    if (isIgnored(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listSkillFiles(dir, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export async function packSkill(dir: string): Promise<PackedSkill> {
  const files = await listSkillFiles(dir);
  const contents: Record<string, Uint8Array> = {};
  const hasher = new Bun.CryptoHasher('sha256');
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(join(dir, file)));
    contents[file] = bytes;
    hasher.update(`${file}\0${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}\n`);
  }
  const bundle = await new Bun.Archive(contents, { compress: 'gzip' }).bytes();
  return { contentHash: hasher.digest('hex'), bundle, files };
}

/** Where mirrorEnabledSkills keeps a skill's copy (skills already under ~/.fl0w/skills aren't copied). */
const mirroredDir = (skill: SkillSummary) => {
  const skillDir = dirname(resolve(skill.path));
  return isUnderFl0wSkills(skillDir) ? skillDir : join(FL0W_SKILLS_DIR, basename(skillDir));
};

export type SkillSyncResult = 'unchanged' | 'pushed' | Error;
export type SkillSyncResults = Record<string, SkillSyncResult>;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Uploads enabled skills (from their ~/.fl0w/skills mirror) to fl0w-work so remote workflow runs can
 * pull them. Keyed by skill name, which is what workflows store. Only bundles whose content hash differs
 * from the server's are sent. Returns null when not signed in or `sync: false` is set in config.json.
 */
export async function syncEnabledSkills(
  selection: CapabilitySelection,
  catalog: SkillSummary[],
): Promise<SkillSyncResults | null> {
  const run = queue.then(async () => {
    if (selection.skills.length === 0) return {};
    if (!(await readFl0wAuth()) || !(await isConfigSyncEnabled())) return null;

    const byName = new Map(catalog.map((skill) => [skill.name, skill]));
    const remote = new Map((await listRemoteSkills()).map((skill) => [skill.name, skill.contentHash]));
    const results: SkillSyncResults = {};

    for (const name of selection.skills) {
      const skill = byName.get(name);
      if (!skill) continue;
      try {
        const packed = await packSkill(mirroredDir(skill));
        if (remote.get(name) === packed.contentHash) {
          results[name] = 'unchanged';
          continue;
        }
        if (packed.bundle.byteLength > MAX_SKILL_BUNDLE_BYTES) {
          throw new Error(`Skill "${name}" is ${packed.bundle.byteLength} bytes compressed; the sync limit is ${MAX_SKILL_BUNDLE_BYTES}`);
        }
        await putSkillBundle(name, packed.contentHash, packed.bundle);
        results[name] = 'pushed';
      } catch (error) {
        results[name] = error instanceof Error ? error : new Error(String(error));
      }
    }
    return results;
  });
  queue = run.catch(() => { });
  return run;
}

/** Background sync after a mirror; failures are logged and retried the next time capabilities are applied. */
export async function syncEnabledSkillsInBackground(
  selection: CapabilitySelection,
  catalog: SkillSummary[],
): Promise<void> {
  try {
    const results = await syncEnabledSkills(selection, catalog);
    for (const [name, result] of Object.entries(results ?? {})) {
      if (result instanceof Error) console.warn(`Failed to sync skill "${name}" to fl0w-work: ${result.message}`);
    }
  } catch (error) {
    console.warn(`Skill sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
