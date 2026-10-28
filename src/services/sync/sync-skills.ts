import { cp, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FL0W_SKILLS_DIR } from '../../constants';
import type { BundleBase } from '../../models/sync';
import { SKILL_FILENAME, skillService, type SkillSummary } from '../external-tools/skill-service';
import { authService } from '../auth/auth-service';
import { deleteRemoteSkill, getSkillBundle, listRemoteSkills, putSkillBundle } from '../remote-api/sync-api';
import { bundleStateStore } from './state/bundle-state';
import {
  packFiles,
  removeBundleFiles,
  syncBundle,
  type BundleSide,
  type BundleSyncResult,
  type LocalBundle,
  type PackedSkill,
} from './bundle-sync';

export { MAX_SKILL_BUNDLE_BYTES, packFiles, type PackedSkill } from './bundle-sync';

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const IGNORED_PATTERNS = [/^\.env(\..*)?$/, /\.pem$/, /\.key$/];

const isIgnored = (name: string) => IGNORED_NAMES.has(name) || IGNORED_PATTERNS.some((p) => p.test(name));

export type MirrorSkillsResult = {
  mirrored: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
};

export type SkillSyncResult = BundleSyncResult;
export type SkillSyncResults = Record<string, SkillSyncResult>;

class SyncSkillService {
  private syncQueue: Promise<unknown> = Promise.resolve();

  async mirrorSkills(catalog: SkillSummary[]): Promise<MirrorSkillsResult> {
    const result: MirrorSkillsResult = { mirrored: [], skipped: [], errors: [] };
    if (catalog.length === 0) return result;

    await mkdir(FL0W_SKILLS_DIR, { recursive: true });

    for (const skill of catalog) {
      const skillDir = dirname(resolve(skill.path));
      if (this.isUnderFl0wSkills(skillDir)) {
        result.skipped.push(skill.name);
        continue;
      }

      const dest = join(FL0W_SKILLS_DIR, basename(skillDir));

      try {
        await rm(dest, { recursive: true, force: true });
        await cp(skillDir, dest, { recursive: true, force: true });
        result.mirrored.push(skill.name);
      } catch (error) {
        result.errors.push({
          name: skill.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async packSkill(dir: string): Promise<PackedSkill> {
    return packFiles(dir, await this.listSkillFiles(dir));
  }

  /**
   * Syncs every skill in `catalog`, on fl0w-work, or synced before, both ways. Changes from fl0w-work land in the
   * skill's own folder (e.g. ~/.claude/skills/<name>), then its ~/.fl0w/skills mirror is refreshed.
   */
  async syncSkills(catalog: SkillSummary[]): Promise<SkillSyncResults | null> {
    const run = this.syncQueue.then(async () => {
      const auth = await authService.readFl0wAuth();
      if (!auth) return null;

      const remote = new Map((await listRemoteSkills()).map((skill) => [skill.name, skill]));
      const bases = await bundleStateStore.read(auth.user.id, 'skills');
      const local = new Map(catalog.map((skill) => [skill.name, skill]));
      const names = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(bases)])].sort();
      const results: SkillSyncResults = {};

      for (const name of names) {
        try {
          const located = await this.locate(local.get(name), bases[name]);
          const outcome = await syncBundle(this.side, name, located, remote.get(name) ?? null, bases[name]);
          if (outcome.base) bases[name] = outcome.base;
          else delete bases[name];
          if (outcome.result === 'deleted' && located) await this.dropMirror(located.dir);
          else if (outcome.changedLocally) await this.refreshMirror(outcome.changedLocally.dir);
          results[name] = outcome.result;
        } catch (error) {
          results[name] = error instanceof Error ? error : new Error(String(error));
        }
      }
      await bundleStateStore.write(auth.user.id, 'skills', bases);
      return results;
    });
    this.syncQueue = run.catch(() => { });
    return run;
  }

  async syncAllSkills(): Promise<SkillSyncResults | null> {
    const catalog = await skillService.discoverSkills();
    this.logMirrorResult(await this.mirrorSkills(catalog));
    return this.syncSkills(catalog);
  }

  async syncAllSkillsInBackground(): Promise<void> {
    try {
      const results = await this.syncAllSkills();
      for (const [name, result] of Object.entries(results ?? {})) {
        if (result instanceof Error) console.warn(`Failed to sync skill "${name}" with fl0w-work: ${result.message}`);
      }
    } catch (error) {
      console.warn(`Skill sync with fl0w-work failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private logMirrorResult(result: MirrorSkillsResult): void {
    for (const { name, error } of result.errors) {
      console.warn(`Failed to mirror skill "${name}" to ~/.fl0w/skills: ${error}`);
    }
  }

  private isUnderFl0wSkills(skillDir: string): boolean {
    const base = resolve(FL0W_SKILLS_DIR);
    const target = resolve(skillDir);
    return target === base || target.startsWith(`${base}/`);
  }

  private readonly side: BundleSide = {
    kind: 'skills',
    label: 'Skill',
    get: getSkillBundle,
    put: putSkillBundle,
    remove: deleteRemoteSkill,
    place: (name) => this.localSkill(join(FL0W_SKILLS_DIR, name)),
    removeLocal: async (local, files) => {
      await removeBundleFiles(local.dir, files);
      await rmdir(local.dir).catch(() => { });
    },
  };

  private localSkill(dir: string): LocalBundle {
    return { dir, listFiles: () => this.listSkillFiles(dir) };
  }

  /**
   * Where a skill lives on this device: the folder it was last synced in, else where discovery found it. Null when it
   * never existed here; a LocalBundle with no files when it was deleted here (a leftover mirror doesn't count).
   */
  private async locate(skill: SkillSummary | undefined, base: BundleBase | undefined): Promise<LocalBundle | null> {
    const found = skill ? dirname(resolve(skill.path)) : undefined;
    if (!base) return found ? this.localSkill(found) : null;
    if (await Bun.file(join(base.dir, SKILL_FILENAME)).exists()) return this.localSkill(base.dir);
    if (found && found !== this.mirrorDir(base.dir)) return this.localSkill(found);
    return { dir: base.dir, listFiles: async () => null };
  }

  private mirrorDir(skillDir: string): string {
    return this.isUnderFl0wSkills(skillDir) ? skillDir : join(FL0W_SKILLS_DIR, basename(skillDir));
  }

  /** Re-copies a skill from outside ~/.fl0w/skills into its mirror after sync changed it. */
  private async refreshMirror(skillDir: string): Promise<void> {
    if (this.isUnderFl0wSkills(skillDir)) return;
    const dest = this.mirrorDir(skillDir);
    await rm(dest, { recursive: true, force: true });
    if (await Bun.file(join(skillDir, SKILL_FILENAME)).exists()) await cp(skillDir, dest, { recursive: true, force: true });
  }

  /** A deleted skill's mirror would otherwise be found, and synced, as a new skill. */
  private async dropMirror(skillDir: string): Promise<void> {
    if (!this.isUnderFl0wSkills(skillDir)) await rm(this.mirrorDir(skillDir), { recursive: true, force: true });
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
