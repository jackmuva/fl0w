import type { ModelMetadata } from '../models/agent';
import { DEFAULT_CONTEXT_WINDOW } from '../constants';
import { listModels } from '../services/remote-api/ai-api';

class ModelStore {
  private cache: Promise<Map<string, ModelMetadata>> | null = null;

  loadModels(): Promise<Map<string, ModelMetadata>> {
    return this.cache ??= listModels()
      .then((models: ModelMetadata[]) => new Map(models.map((metadata) => [metadata.model, metadata])))
      .catch((error: unknown) => {
        this.cache = null;
        throw error;
      });
  }

  async contextWindowFor(model: string): Promise<number> {
    return (await this.loadModels()).get(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }

  /** Models are assumed to accept images unless their metadata says otherwise. */
  async supportsImages(model: string): Promise<boolean> {
    const models = await this.loadModels().catch(() => new Map<string, ModelMetadata>());
    return models.get(model)?.supportsImages !== false;
  }
}

export const modelStore = new ModelStore();
