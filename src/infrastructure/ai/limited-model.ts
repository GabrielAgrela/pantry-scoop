import type { DailyAiLimit } from '../../application/daily-ai-limit.ts';
import type { StructuredModel, StructuredRequest } from './structured-model.ts';

/** Counts each AI call against the person's daily allowance; a failed call is given back. */
export class LimitedModel implements StructuredModel {
  private readonly model: StructuredModel;
  private readonly limit: DailyAiLimit;
  private readonly userId: number;

  constructor(model: StructuredModel, limit: DailyAiLimit, userId: number) {
    this.model = model;
    this.limit = limit;
    this.userId = userId;
  }

  async complete(request: StructuredRequest): Promise<unknown> {
    const refund = this.limit.consume(this.userId);
    try {
      return await this.model.complete(request);
    } catch (error) {
      refund();
      throw error;
    }
  }
}
