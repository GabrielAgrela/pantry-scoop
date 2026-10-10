import type { AiAllowance } from '../../application/daily-ai-limit.ts';
import type { StructuredModel, StructuredRequest } from './structured-model.ts';

/** Charges each AI call to the person's daily allowance, through the action it belongs to. */
export class LimitedModel implements StructuredModel {
  private readonly model: StructuredModel;
  private readonly allowance: AiAllowance;

  constructor(model: StructuredModel, allowance: AiAllowance) {
    this.model = model;
    this.allowance = allowance;
  }

  complete(request: StructuredRequest): Promise<unknown> {
    return this.allowance.call(() => this.model.complete(request));
  }
}
