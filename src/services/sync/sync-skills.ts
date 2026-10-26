import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FL0W_SKILLS_DIR } from '../../constants';
import type { CapabilitySelection } from '../../models/agent';
import type { SkillSummary } from '../agent/hooks/front-load';
import { authService } from '../auth/auth-service';
import { listRemoteSkills, putSkillBundle } from '../remote-api/sync-api';

/** Matches fl0w-work's limit, which sits under Vercel's 4.5 MB request body cap. */
export const MAX_SKILL_BUNDLE_BYTES = 4 * 1024 * 1024;
const MIRROR_DEBOUNCE_MS = 400;

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

const isIgnored = (name: string) => IGNORED_NAMES.has(name) || IGNORED_PATTERNS.some((p) => p.test(name));

export type PackedSkill = {
  /** sha256 over sorted paths + file bytes; stable across runs, unlike the tarball (which embeds mtimes). */
  contentHash: string;
  bundle: Uint8Array<ArrayBuffer>;
  files: string[];
};

export type MirrorEnabledSkillsResult = {
  mirrored: string[];
  skipped: string[];
  missing: string[];
  errors: Array<{ name: string; error: string }>;
};

export type SkillSyncResult = 'unchanged' | 'pushed' | Error;
export type SkillSyncResults = Record<string, SkillSyncResult>;

type QueuedMirror = { selection: CapabilitySelection; catalog: SkillSummary[] };

/** Packs `files` (paths relative to `dir`) into a .tar.gz with a content hash; shared with user tool sync. */
export async function packFiles(dir: string, files: string[]): Promise<PackedSkill> {
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

class SyncSkillService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedMirror: QueuedMirror | null = null;
  private mirrorQueue: Promise<void> = Promise.resolve();
  private syncQueue: Promise<unknown> = Promise.resolve();

  async mirrorEnabledSkills(
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
      if (this.isUnderFl0wSkills(skillDir)) {
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

  scheduleMirrorEnabledSkills(selection: CapabilitySelection, catalog: SkillSummary[]): void {
    this.queuedMirror = { selection, catalog };
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runQueuedMirror();
    }, MIRROR_DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  flushPendingSkillMirrorsInBackground(): void {
    void this.flushPendingSkillMirrors();
  }

  async flushPendingSkillMirrors(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.runQueuedMirror();
    await this.mirrorQueue;
  }

  async packSkill(dir: string): Promise<PackedSkill> {
    return packFiles(dir, await this.listSkillFiles(dir));
  }

  async syncEnabledSkills(
    selection: CapabilitySelection,
    catalog: SkillSummary[],
  ): Promise<SkillSyncResults | null> {
    const run = this.syncQueue.then(async () => {
      if (selection.skills.length === 0) return {};
      if (!(await authService.readFl0wAuth())) return null;

      const byName = new Map(catalog.map((skill) => [skill.name, skill]));
      const remote = new Map((await listRemoteSkills()).map((skill) => [skill.name, skill.contentHash]));
      const results: SkillSyncResults = {};

      for (const name of selection.skills) {
        const skill = byName.get(name);
        if (!skill) continue;
        try {
          const packed = await this.packSkill(this.mirroredDir(skill));
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
    this.syncQueue = run.catch(() => { });
    return run;
  }

  async syncEnabledSkillsInBackground(
    selection: CapabilitySelection,
    catalog: SkillSummary[],
  ): Promise<void> {
    try {
      const results = await this.syncEnabledSkills(selection, catalog);
      for (const [name, result] of Object.entries(results ?? {})) {
        if (result instanceof Error) console.warn(`Failed to sync skill "${name}" to fl0w-work: ${result.message}`);
      }
    } catch (error) {
      console.warn(`Skill sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private runQueuedMirror(): Promise<void> {
    const work = this.queuedMirror;
    this.queuedMirror = null;
    if (!work) return this.mirrorQueue;

    this.mirrorQueue = this.mirrorQueue.then(async () => {
      this.logMirrorResult(await this.mirrorEnabledSkills(work.selection, work.catalog));
      // upload from the fresh mirror, but outside this queue so a slow network never delays a flush
      void this.syncEnabledSkillsInBackground(work.selection, work.catalog);
    }).catch(() => { });
    return this.mirrorQueue;
  }

  private logMirrorResult(result: MirrorEnabledSkillsResult): void {
    for (const name of result.missing) {
      console.warn(`Enabled skill "${name}" was not found; skipping mirror to ~/.fl0w/skills.`);
    }
    for (const { name, error } of result.errors) {
      console.warn(`Failed to mirror skill "${name}" to ~/.fl0w/skills: ${error}`);
    }
  }

  private isUnderFl0wSkills(skillDir: string): boolean {
    const base = resolve(FL0W_SKILLS_DIR);
    const target = resolve(skillDir);
    return target === base || target.startsWith(`${base}/`);
  }

  private mirroredDir(skill: SkillSummary): string {
    const skillDir = dirname(resolve(skill.path));
    return this.isUnderFl0wSkills(skillDir) ? skillDir : join(FL0W_SKILLS_DIR, basename(skillDir));
  }

  private async listSkillFiles(dir: string, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
      if (isIgnored(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...await this.listSkillFiles(dir, path));
      else if (entry.isFile()) files.push(path);
    }
    return files.sort();
  }
}

export const syncSkillService = new SyncSkillService();
