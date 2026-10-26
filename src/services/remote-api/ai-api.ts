import type { ModelMetadata } from "../../models/agent";
import { asErrorBody, fail, readResponseJson, request } from "./utils";

export async function listModels(): Promise<ModelMetadata[]> {
  const res = await request('/cli/ai/models');
  if (!res.ok) return fail(res, 'models');
  const body = asErrorBody(await readResponseJson(res)) as { models?: unknown };
  return Array.isArray(body.models) ? body.models as ModelMetadata[] : [];
}
