import type { ModelMetadata } from "../../models/ai-model";
import { asErrorBody, fail, readResponseJson, request } from "./utils";

export async function listModels(): Promise<ModelMetadata[]> {
  //mock for now
  return [
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextWindow: 1000000,
      type: "text"
    }
  ];

  const res = await request('/cli/ai/models');
  if (!res.ok) return fail(res, 'models');
  const body = asErrorBody(await readResponseJson(res)) as { models?: unknown };
  return Array.isArray(body.models) ? body.models as ModelMetadata[] : [];
}
