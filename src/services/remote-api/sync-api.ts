import type { JsonObject, RemoteFile, RemoteFileMeta, RemoteSkillMeta, RemoteToolMeta, SyncFilename } from '../../models/sync';
import type { SessionListEntry, StoredSession } from '../../models/session';
import { isWorkflowRecord, type WorkflowRecord } from '../../models/workflow';
import { normalizeWorkflowSteps } from '../workflow/generate';
import { UPLOAD_TIMEOUT_MS, request, readResponseJson, asErrorBody, fail } from './utils';

export class SyncConflictError extends Error {
  constructor(readonly filename: SyncFilename) {
    super(`${filename} changed on fl0w-work since it was last synced`);
  }
}

export async function listRemote(): Promise<RemoteFileMeta[]> {
  const res = await request('/sync/config-files');
  if (!res.ok) return fail(res, 'list');
  const body = asErrorBody(await readResponseJson(res)) as { files?: unknown };
  return Array.isArray(body.files) ? body.files as RemoteFileMeta[] : [];
}

export async function getRemote(filename: SyncFilename): Promise<RemoteFile | null> {
  const res = await request(`/sync/config-files/${encodeURIComponent(filename)}`);
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
  const res = await request(`/sync/config-files/${encodeURIComponent(filename)}`, {
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

/** Every workflow the user has, newest first. Workflows saved in the old step format are skipped. */
export async function listRemoteWorkflows(): Promise<WorkflowRecord[]> {
  const res = await request('/sync/workflows');
  if (!res.ok) return fail(res, 'list', 'Workflow');
  const body = asErrorBody(await readResponseJson(res)) as { workflows?: unknown };
  return Array.isArray(body.workflows) ? body.workflows.filter(isWorkflowRecord) : [];
}

export async function getRemoteWorkflow(id: string): Promise<WorkflowRecord | null> {
  const res = await request(`/sync/workflows/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${id}`, 'Workflow');
  const parsed = asErrorBody(await readResponseJson(res)) as { workflow?: unknown };
  if (!parsed.workflow || !Array.isArray((parsed.workflow as { steps?: unknown }).steps)) throw new Error(`Workflow sync pull of ${id} failed: invalid response body`);
  if (!isWorkflowRecord(parsed.workflow)) throw new Error(`Workflow ${id} was saved in an older format; regenerate it from its session`);
  return parsed.workflow;
}

/** False when the workflow already exists on fl0w-work (409); workflows are immutable, so there's nothing to update. */
export async function pushWorkflow(workflow: WorkflowRecord): Promise<boolean> {
  const payload = { ...workflow, steps: normalizeWorkflowSteps(workflow.steps) };
  const res = await request('/sync/workflows', { method: 'POST', body: JSON.stringify(payload) });
  if (res.status === 409) return false;
  if (!res.ok) return fail(res, `push of "${workflow.title}"`, 'Workflow');
  return true;
}

/** Already gone on fl0w-work (404) counts as deleted. */
export async function deleteRemoteWorkflow(id: string): Promise<void> {
  const res = await request(`/sync/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) return fail(res, `delete of ${id}`, 'Workflow');
}

/** Sessions without their messages, newest first; `workspacePath` limits them to one workspace. */
export async function listRemoteSessions(workspacePath?: string): Promise<SessionListEntry[]> {
  const query = workspacePath === undefined ? '' : `?workspacePath=${encodeURIComponent(workspacePath)}`;
  const res = await request(`/sync/sessions${query}`);
  if (!res.ok) return fail(res, 'list', 'Session');
  const body = asErrorBody(await readResponseJson(res)) as { sessions?: unknown };
  return Array.isArray(body.sessions) ? body.sessions as SessionListEntry[] : [];
}

export async function getRemoteSession(id: string): Promise<StoredSession | null> {
  const res = await request(`/sync/sessions/${encodeURIComponent(id)}`, {}, UPLOAD_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of ${id}`, 'Session');
  const parsed = asErrorBody(await readResponseJson(res)) as { session?: StoredSession };
  if (!parsed.session || !Array.isArray(parsed.session.messages)) throw new Error(`Session sync pull of ${id} failed: invalid response body`);
  return parsed.session;
}

/** False when fl0w-work refuses the copy for good: it holds one at least as new (409) or it's too large (413). */
export async function pushSession({ id, ...session }: StoredSession): Promise<boolean> {
  const res = await request(`/sync/sessions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(session) }, UPLOAD_TIMEOUT_MS);
  if (res.status === 409 || res.status === 413) return false;
  if (!res.ok) return fail(res, `push of "${session.title ?? id}"`, 'Session');
  return true;
}

/** Already gone on fl0w-work (404) counts as deleted. */
export async function deleteRemoteSession(id: string): Promise<void> {
  const res = await request(`/sync/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) return fail(res, `delete of ${id}`, 'Session');
}

export async function listRemoteSkills(): Promise<RemoteSkillMeta[]> {
  const res = await request('/sync/skills');
  if (!res.ok) return fail(res, 'list', 'Skill');
  const body = asErrorBody(await readResponseJson(res)) as { skills?: unknown };
  return Array.isArray(body.skills) ? body.skills as RemoteSkillMeta[] : [];
}

export async function putSkillBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>): Promise<RemoteSkillMeta> {
  const res = await request(`/sync/skills/${encodeURIComponent(name)}`, {
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
  const res = await request('/sync/tools');
  if (!res.ok) return fail(res, 'list', 'Tool');
  const body = asErrorBody(await readResponseJson(res)) as { tools?: unknown };
  return Array.isArray(body.tools) ? body.tools as RemoteToolMeta[] : [];
}

export async function putToolBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>): Promise<RemoteToolMeta> {
  const res = await request(`/sync/tools/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/gzip', 'x-tool-content-hash': contentHash },
    body: bundle,
  }, UPLOAD_TIMEOUT_MS);
  if (!res.ok) return fail(res, `push of "${name}"`, 'Tool');
  const parsed = asErrorBody(await readResponseJson(res)) as { tool?: RemoteToolMeta };
  if (!parsed.tool) throw new Error(`Tool sync push of "${name}" failed: invalid response body`);
  return parsed.tool;
}
