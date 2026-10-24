import { FL0W_API_URL } from '../../constants';
import type { JsonObject, RemoteFile, RemoteFileMeta, RemoteSession, RemoteSessionMeta, RemoteSkillMeta, RemoteToolMeta, RemoteWorkflowMeta, SyncFilename } from '../../models/sync';
import { type WorkflowRecord } from '../../models/workflow';
import { getAccessToken } from '../auth/token';
import { normalizeWorkflowSteps } from '../workflow/generate';

const REQUEST_TIMEOUT_MS = 5_000;
// skill/tool bundles and long sessions are up to a few MB, which a slow uplink won't send in 5s
const UPLOAD_TIMEOUT_MS = 60_000;

export class SyncConflictError extends Error {
  constructor(readonly filename: SyncFilename) {
    super(`${filename} changed on fl0w-work since it was last synced`);
  }
}

async function request(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const send = async (force: boolean) => fetch(`${FL0W_API_URL}/api/sync${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${await getAccessToken({ force })}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const res = await send(false);
  return res.status === 401 ? send(true) : res;
}

type ErrorBody = { error?: string, error_description?: string };

const readResponseJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const asErrorBody = (value: unknown): ErrorBody =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as ErrorBody;

async function fail(res: Response, action: string, kind = 'Config'): Promise<never> {
  const body = asErrorBody(await readResponseJson(res));
  throw new Error(`${kind} sync ${action} failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
}

export async function listRemote(): Promise<RemoteFileMeta[]> {
  const res = await request('/config-files');
  if (!res.ok) return fail(res, 'list');
  const body = asErrorBody(await readResponseJson(res)) as { files?: unknown };
  return Array.isArray(body.files) ? body.files as RemoteFileMeta[] : [];
}

export async function getRemote(filename: SyncFilename): Promise<RemoteFile | null> {
  const res = await request(`/config-files/${encodeURIComponent(filename)}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${filename}`);
  const parsed = await readResponseJson(res);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config sync pull of ${filename} failed: invalid response body`);
  }
  return parsed as RemoteFile;
}

/** `baseVersion` 0 creates the file; otherwise it must match the server's version or this throws SyncConflictError. */
export async function putRemote(filename: SyncFilename, content: JsonObject, baseVersion: number): Promise<RemoteFileMeta> {
  const res = await request(`/config-files/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content, baseVersion }),
  });
  if (res.status === 409) throw new SyncConflictError(filename);
  if (!res.ok) return fail(res, `push of ${filename}`);
  const parsed = asErrorBody(await readResponseJson(res)) as { configFile?: RemoteFileMeta };
  if (!parsed.configFile) {
    throw new Error(`Config sync push of ${filename} failed: invalid response body`);
  }
  return parsed.configFile;
}

export async function listRemoteWorkflows(): Promise<RemoteWorkflowMeta[]> {
  const res = await request('/workflows');
  if (!res.ok) return fail(res, 'list', 'Workflow');
  const body = asErrorBody(await readResponseJson(res)) as { workflows?: unknown };
  return Array.isArray(body.workflows) ? body.workflows as RemoteWorkflowMeta[] : [];
}

export async function getRemoteWorkflow(id: string): Promise<WorkflowRecord | null> {
  const res = await request(`/workflows/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${id}`, 'Workflow');
  const parsed = asErrorBody(await readResponseJson(res)) as { workflow?: WorkflowRecord };
  if (!parsed.workflow || !Array.isArray(parsed.workflow.steps)) throw new Error(`Workflow sync pull of ${id} failed: invalid response body`);
  return parsed.workflow;
}

export async function pushWorkflow(workflow: WorkflowRecord): Promise<boolean> {
  const payload = { ...workflow, steps: normalizeWorkflowSteps(workflow.steps) };
  const res = await request('/workflows', { method: 'POST', body: JSON.stringify(payload) });
  if (res.status === 409) return false;
  if (!res.ok) return fail(res, `push of "${workflow.title}"`, 'Workflow');
  return true;
}

/** Already gone on fl0w-work (404) counts as deleted. */
export async function deleteRemoteWorkflow(id: string): Promise<void> {
  const res = await request(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) return fail(res, `delete of ${id}`, 'Workflow');
}

export async function listRemoteSessions(): Promise<RemoteSessionMeta[]> {
  const res = await request('/sessions');
  if (!res.ok) return fail(res, 'list', 'Session');
  const body = asErrorBody(await readResponseJson(res)) as { sessions?: unknown };
  return Array.isArray(body.sessions) ? body.sessions as RemoteSessionMeta[] : [];
}

export async function getRemoteSession(id: string): Promise<RemoteSession | null> {
  const res = await request(`/sessions/${encodeURIComponent(id)}`, {}, UPLOAD_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${id}`, 'Session');
  const parsed = asErrorBody(await readResponseJson(res)) as { session?: RemoteSession };
  if (!parsed.session || !Array.isArray(parsed.session.messages)) throw new Error(`Session sync pull of ${id} failed: invalid response body`);
  return parsed.session;
}

export async function pushSession({ id, ...session }: RemoteSession): Promise<boolean> {
  const res = await request(`/sessions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(session) }, UPLOAD_TIMEOUT_MS);
  if (res.status === 409 || res.status === 413) return false;
  if (!res.ok) return fail(res, `push of "${session.title ?? id}"`, 'Session');
  return true;
}

/** Already gone on fl0w-work (404) counts as deleted. */
export async function deleteRemoteSession(id: string): Promise<void> {
  const res = await request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) return fail(res, `delete of ${id}`, 'Session');
}

export async function listRemoteSkills(): Promise<RemoteSkillMeta[]> {
  const res = await request('/skills');
  if (!res.ok) return fail(res, 'list', 'Skill');
  const body = asErrorBody(await readResponseJson(res)) as { skills?: unknown };
  return Array.isArray(body.skills) ? body.skills as RemoteSkillMeta[] : [];
}

export async function putSkillBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>): Promise<RemoteSkillMeta> {
  const res = await request(`/skills/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/gzip', 'x-skill-content-hash': contentHash },
    body: bundle,
  }, UPLOAD_TIMEOUT_MS);
  if (!res.ok) return fail(res, `push of "${name}"`, 'Skill');
  const parsed = asErrorBody(await readResponseJson(res)) as { skill?: RemoteSkillMeta };
  if (!parsed.skill) throw new Error(`Skill sync push of "${name}" failed: invalid response body`);
  return parsed.skill;
}

export async function listRemoteTools(): Promise<RemoteToolMeta[]> {
  const res = await request('/tools');
  if (!res.ok) return fail(res, 'list', 'Tool');
  const body = asErrorBody(await readResponseJson(res)) as { tools?: unknown };
  return Array.isArray(body.tools) ? body.tools as RemoteToolMeta[] : [];
}

export async function putToolBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>): Promise<RemoteToolMeta> {
  const res = await request(`/tools/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/gzip', 'x-tool-content-hash': contentHash },
    body: bundle,
  }, UPLOAD_TIMEOUT_MS);
  if (!res.ok) return fail(res, `push of "${name}"`, 'Tool');
  const parsed = asErrorBody(await readResponseJson(res)) as { tool?: RemoteToolMeta };
  if (!parsed.tool) throw new Error(`Tool sync push of "${name}" failed: invalid response body`);
  return parsed.tool;
}
