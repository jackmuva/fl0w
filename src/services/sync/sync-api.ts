import { FL0W_API_URL } from '../../constants';
import type { JsonObject, RemoteFile, RemoteFileMeta, SyncFilename } from '../../models/sync';
import { getAccessToken } from '../auth/token';

const REQUEST_TIMEOUT_MS = 5_000;

export class SyncConflictError extends Error {
  constructor(readonly filename: SyncFilename) {
    super(`${filename} changed on fl0w-work since it was last synced`);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (force: boolean) => fetch(`${FL0W_API_URL}/api/sync/config-files${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${await getAccessToken({ force })}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const res = await send(false);
  // the token may have been revoked or the clock skewed; one forced refresh before giving up
  return res.status === 401 ? send(true) : res;
}

async function fail(res: Response, action: string): Promise<never> {
  const body = await res.json().catch(() => ({})) as { error?: string, error_description?: string };
  throw new Error(`Config sync ${action} failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
}

export async function listRemote(): Promise<RemoteFileMeta[]> {
  const res = await request('');
  if (!res.ok) return fail(res, 'list');
  return ((await res.json()) as { files: RemoteFileMeta[] }).files;
}

export async function getRemote(filename: SyncFilename): Promise<RemoteFile | null> {
  const res = await request(`/${encodeURIComponent(filename)}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${filename}`);
  return await res.json() as RemoteFile;
}

/** `baseVersion` 0 creates the file; otherwise it must match the server's version or this throws SyncConflictError. */
export async function putRemote(filename: SyncFilename, content: JsonObject, baseVersion: number): Promise<RemoteFileMeta> {
  const res = await request(`/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content, baseVersion }),
  });
  if (res.status === 409) throw new SyncConflictError(filename);
  if (!res.ok) return fail(res, `push of ${filename}`);
  return ((await res.json()) as { configFile: RemoteFileMeta }).configFile;
}
