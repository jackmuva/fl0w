import { AUTH_PATH } from '../../constants';
import type { AuthFile } from '../../models/auth';
import { notifyLocalWrite } from '../sync/local-writes';
import { writeJsonAtomic } from '../utils';

export async function readAuthFile(path = AUTH_PATH): Promise<AuthFile> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    return await file.json() as AuthFile;
  } catch {
    return {};
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Applies `update` to auth.json and writes it atomically with 0600 permissions.
 * Returning `file` unchanged skips the write. `notify: false` is for config sync's own writes, so pulled content isn't pushed straight back.
 */
export function updateAuthFile(
  update: (file: AuthFile) => AuthFile,
  path = AUTH_PATH,
  { notify = true } = {},
): Promise<AuthFile> {
  const run = writeQueue.then(async () => {
    const current = await readAuthFile(path);
    const next = update(current);
    if (next === current) return current;
    await writeJsonAtomic(path, next);
    if (notify) notifyLocalWrite(path);
    return next;
  });
  writeQueue = run.catch(() => {});
  return run;
}
