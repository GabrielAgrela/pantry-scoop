import type { ChatGptCredentials } from '../../application/chatgpt-credentials.ts';
import type { ModelCatalog, ModelOption } from '../../ports/model-catalog.ts';
import type { ResponsesClient } from '../openai/responses-client.ts';

/** Per-user model list from GET /v1/models, cached briefly (it rarely changes). */
export class CachedModelCatalog implements ModelCatalog {
  private readonly responses: ResponsesClient;
  private readonly credentials: ChatGptCredentials;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<number, { models: ModelOption[]; expiresAt: number }>();

  constructor(responses: ResponsesClient, credentials: ChatGptCredentials, ttlMs = 60 * 60 * 1000, now: () => number = Date.now) {
    this.responses = responses;
    this.credentials = credentials;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async list(userId: number): Promise<ModelOption[]> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > this.now()) return cached.models;
    const models = await this.responses.listModels(await this.credentials.accessToken(userId));
    this.cache.set(userId, { models, expiresAt: this.now() + this.ttlMs });
    return models;
  }
}
