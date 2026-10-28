import type { BundleKind, JsonObject, RemoteFile, RemoteFileMeta, RemoteSkillMeta, RemoteToolMeta, SyncFilename } from '../../models/sync';
import type { SessionListEntry, StoredSession } from '../../models/session';
import { isWorkflowRecord, type WorkflowRecord } from '../../models/workflow';
import { normalizeWorkflowSteps } from '../workflow/generate';
import { UPLOAD_TIMEOUT_MS, request, readResponseJson, asErrorBody, fail } from './api-utils';

export class SyncConflictError extends Error {
  constructor(readonly filename: SyncFilename) {
    super(`${filename} changed on fl0w-work since it was last synced`);
  }
}

/** fl0w-work's copy of a skill or tool changed since `baseHash`; `current` is that copy (null when it was deleted). */
export class BundleConflictError extends Error {
  constructor(readonly bundleName: string, readonly current: RemoteSkillMeta | null) {
    super(`"${bundleName}" changed on fl0w-work since it was last synced`);
  }
}

export type RemoteBundle = { contentHash: string; bytes: Uint8Array };

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
  return listBundles('skills', 'Skill');
}

export async function listRemoteTools(): Promise<RemoteToolMeta[]> {
  return listBundles('tools', 'Tool');
}

export async function getSkillBundle(name: string): Promise<RemoteBundle | null> {
  return getBundle('skills', 'Skill', name);
}

export async function getToolBundle(name: string): Promise<RemoteBundle | null> {
  return getBundle('tools', 'Tool', name);
}

/**
 * `baseHash` is the copy this upload was merged with (null when there was none); fl0w-work refuses the upload with
 * BundleConflictError if its copy has changed since. Without it the upload always wins.
 */
export async function putSkillBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>, baseHash?: string | null): Promise<RemoteSkillMeta> {
  return putBundle('skills', 'Skill', name, contentHash, bundle, baseHash);
}

export async function putToolBundle(name: string, contentHash: string, bundle: Uint8Array<ArrayBuffer>, baseHash?: string | null): Promise<RemoteToolMeta> {
  return putBundle('tools', 'Tool', name, contentHash, bundle, baseHash);
}

/** Already gone on fl0w-work (404) counts as deleted. */
export async function deleteRemoteSkill(name: string): Promise<void> {
  return deleteBundle('skills', 'Skill', name);
}

export async function deleteRemoteTool(name: string): Promise<void> {
  return deleteBundle('tools', 'Tool', name);
}

type BundleLabel = 'Skill' | 'Tool';

const bundleKey = (kind: BundleKind) => kind === 'skills' ? 'skill' : 'tool';

async function listBundles(kind: BundleKind, label: BundleLabel): Promise<RemoteSkillMeta[]> {
  const res = await request(`/sync/${kind}`);
  if (!res.ok) return fail(res, 'list', label);
  const body = asErrorBody(await readResponseJson(res)) as Record<string, unknown>;
  const list = body[kind];
  return Array.isArray(list) ? list as RemoteSkillMeta[] : [];
}

async function getBundle(kind: BundleKind, label: BundleLabel, name: string): Promise<RemoteBundle | null> {
  const res = await request(`/sync/${kind}/${encodeURIComponent(name)}`, {}, UPLOAD_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res, `pull of "${name}"`, label);
  const contentHash = res.headers.get(`x-${bundleKey(kind)}-content-hash`);
  if (!contentHash) throw new Error(`${label} sync pull of "${name}" failed: missing content hash`);
  return { contentHash, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function putBundle(
  kind: BundleKind,
  label: BundleLabel,
  name: string,
  contentHash: string,
  bundle: Uint8Array<ArrayBuffer>,
  baseHash?: string | null,
): Promise<RemoteSkillMeta> {
  const key = bundleKey(kind);
  const headers: Record<string, string> = { 'content-type': 'application/gzip', [`x-${key}-content-hash`]: contentHash };
  if (baseHash !== undefined) headers['x-base-content-hash'] = baseHash ?? 'none';
  const res = await request(`/sync/${kind}/${encodeURIComponent(name)}`, { method: 'PUT', headers, body: bundle }, UPLOAD_TIMEOUT_MS);
  if (res.status === 409) {
    const body = asErrorBody(await readResponseJson(res)) as Record<string, unknown>;
    throw new BundleConflictError(name, (body[key] as RemoteSkillMeta | null | undefined) ?? null);
  }
  if (!res.ok) return fail(res, `push of "${name}"`, label);
  const parsed = asErrorBody(await readResponseJson(res)) as Record<string, unknown>;
  const meta = parsed[key] as RemoteSkillMeta | undefined;
  if (!meta) throw new Error(`${label} sync push of "${name}" failed: invalid response body`);
  return meta;
}

async function deleteBundle(kind: BundleKind, label: BundleLabel, name: string): Promise<void> {
  const res = await request(`/sync/${kind}/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) return fail(res, `delete of "${name}"`, label);
}
