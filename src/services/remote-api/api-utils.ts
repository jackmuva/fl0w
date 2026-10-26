import { FL0W_API_URL } from "../../constants";
import { authService } from "../auth/auth-service";

export const REQUEST_TIMEOUT_MS = 5_000;
// skill/tool bundles and long sessions are up to a few MB, which a slow uplink won't send in 5s
export const UPLOAD_TIMEOUT_MS = 60_000;

export async function request(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const send = async (force: boolean) => fetch(`${FL0W_API_URL}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers, authorization: `Bearer ${await authService.getAccessToken({ force })}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const res = await send(false);
  return res.status === 401 ? send(true) : res;
}

export type ErrorBody = { error?: string, error_description?: string };

export const readResponseJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export const asErrorBody = (value: unknown): ErrorBody =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as ErrorBody;

/** A non-2xx response from fl0w-work; `status` tells a rejected request from a transient failure. */
export class SyncHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function fail(res: Response, action: string, kind = 'Config'): Promise<never> {
  const body = asErrorBody(await readResponseJson(res));
  throw new SyncHttpError(`${kind} sync ${action} failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`, res.status);
}


