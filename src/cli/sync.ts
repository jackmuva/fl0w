import type { SyncFilename } from '../models/sync';
import { runFullSync, type FullSyncResult } from '../services/sync/full-sync';
import type { SyncResults } from '../services/sync/config-sync';

const HELP_FLAGS = new Set(['help', '-h', '--help']);

const formatConfig = (results: SyncResults | null): string[] => {
  if (!results) return [];
  const lines: string[] = [];
  for (const [file, result] of Object.entries(results) as [SyncFilename, SyncResults[SyncFilename]][]) {
    if (result instanceof Error) lines.push(`  ${file}: error — ${result.message}`);
    else lines.push(`  ${file}: ${result}`);
  }
  return lines;
};

const formatNamedResults = (label: string, results: Record<string, 'unchanged' | 'pushed' | Error> | null): string[] => {
  if (!results || Object.keys(results).length === 0) return [`${label}: nothing to sync.`];
  const lines = [`${label}:`];
  for (const [name, result] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
    if (result instanceof Error) lines.push(`  ${name}: error — ${result.message}`);
    else lines.push(`  ${name}: ${result}`);
  }
  return lines;
};

export const printFullSyncResult = (result: FullSyncResult): void => {
  if (result.skipped === 'not-signed-in') {
    console.error('Not signed in. Run `fl0w login` first.');
    return;
  }
  if (result.skipped === 'sync-disabled') {
    console.error('Sync is disabled on this device (`sync: false` in config.json).');
    return;
  }

  console.log('Config files:');
  for (const line of formatConfig(result.config)) console.log(line);

  console.log(result.pendingWrites
    ? `Sessions and workflows: ${result.pendingWrites} writes could not be pushed yet; they retry on the next run`
    : 'Sessions and workflows: all writes pushed');

  for (const block of [
    formatNamedResults('Skills', result.skills),
    formatNamedResults('Tools', result.tools),
  ]) {
    for (const line of block) console.log(line);
  }
};

const hasErrors = (result: FullSyncResult): boolean => {
  if (result.skipped) return true;
  if (result.config && Object.values(result.config).some((r) => r instanceof Error)) return true;
  if (result.skills && Object.values(result.skills).some((r) => r instanceof Error)) return true;
  if (result.tools && Object.values(result.tools).some((r) => r instanceof Error)) return true;
  return Boolean(result.pendingWrites);
};

export const runSyncCommand = async (argv: string[]): Promise<number> => {
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) {
      console.log(`Usage: fl0w sync

Pull and push config (config.json, mcp.json, auth.json), skills, and user tools with fl0w-work, and push any
session and workflow writes still waiting in ~/.fl0w/outbox (fl0w-work is where sessions and workflows live).
Requires \`fl0w login\` and sync enabled in config.json (default on).`);
      return 0;
    }
    console.error(`Unknown option for sync: ${arg}`);
    return 1;
  }

  const result = await runFullSync();
  printFullSyncResult(result);
  return hasErrors(result) ? 1 : 0;
};
