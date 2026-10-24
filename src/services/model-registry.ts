import type { ModelMetadata } from '../models/ai-model';
import { DEFAULT_CONTEXT_WINDOW } from '../constants';
import { listModels } from './remote-api/ai-api';

let cache: Promise<Map<string, ModelMetadata>> | null = null;

// Fetched once per process; a failed fetch clears the cache so the next call retries.
export const loadModels = (): Promise<Map<string, ModelMetadata>> =>
  cache ??= listModels()
    .then((models) => new Map(models.map((metadata) => [metadata.model, metadata])))
    .catch((error) => {
      cache = null;
      throw error;
    });

export const contextWindowFor = async (model: string): Promise<number> =>
  (await loadModels()).get(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
