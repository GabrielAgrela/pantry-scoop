import type { ChatGptCredentials } from '../../application/chatgpt-credentials.ts';
import { AiUnavailableError, AuthRequiredError } from '../../domain/errors.ts';
import type { UserRepository } from '../../ports/account-repositories.ts';
import type { ModelCatalog } from '../../ports/model-catalog.ts';
import type { ResponsesClient } from '../openai/responses-client.ts';
import type { StructuredModel, StructuredRequest } from './structured-model.ts';

export interface ChatGptPlanDeps {
  readonly credentials: ChatGptCredentials;
  readonly responses: ResponsesClient;
  readonly catalog: ModelCatalog;
  readonly users: UserRepository;
  /** Server-wide default model slug; empty = first model the user's plan lists. */
  readonly defaultModel: string;
}

/** A StructuredModel that runs on one signed-in user's ChatGPT plan. */
export class ChatGptPlanModel implements StructuredModel {
  private readonly userId: number;
  private readonly deps: ChatGptPlanDeps;

  constructor(userId: number, deps: ChatGptPlanDeps) {
    this.userId = userId;
    this.deps = deps;
  }

  async complete(request: StructuredRequest): Promise<unknown> {
    const accessToken = await this.deps.credentials.accessToken(this.userId);
    const model = await this.model();
    try {
      return await this.deps.responses.complete(accessToken, { ...request, model });
    } catch (error) {
      if (error instanceof AuthRequiredError) this.deps.credentials.invalidate(this.userId);
      throw error;
    }
  }

  private async model(): Promise<string> {
    const chosen = this.deps.users.findById(this.userId)?.model || this.deps.defaultModel;
    if (chosen) return chosen;
    const [first] = await this.deps.catalog.list(this.userId);
    if (!first) throw new AiUnavailableError('Your ChatGPT plan has no models available to apps right now.');
    return first.slug;
  }
}
