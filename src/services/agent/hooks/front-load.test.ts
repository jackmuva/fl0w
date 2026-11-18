import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteStore } from '../../../store/remote-store';
import { formatRemoteFileLinkInstructions, frontLoadInstructions } from './front-load';

describe('formatRemoteFileLinkInstructions', () => {
  test('prefixes paths with the workspace dir relative to the sandbox home', () => {
    const text = formatRemoteFileLinkInstructions('/vercel/sandbox/computer', '/vercel/sandbox');
    expect(text).toContain('/remote/files?path=computer%2Fdashboards%2Fmorning.html');
    expect(text).toContain('"computer/" followed by');
  });

  test('uses no prefix when the workspace is outside home', () => {
    const text = formatRemoteFileLinkInstructions('/srv/work', '/vercel/sandbox');
    expect(text).toContain('/remote/files?path=dashboards%2Fmorning.html');
  });
});

describe('frontLoadInstructions remote links', () => {
  let dir: string | undefined;
  afterEach(async () => {
    remoteStore.set(false);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('includes link instructions only when remote is set', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fl0w-front-load-'));
    expect(await frontLoadInstructions(dir)).not.toContain('/remote/files?path=');
    remoteStore.set(true);
    expect(await frontLoadInstructions(dir)).toContain('/remote/files?path=');
  });
});
