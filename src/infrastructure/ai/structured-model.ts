import type { ImageInput } from '../../domain/image.ts';
import type { ReasoningEffort } from '../openai/responses-client.ts';

export interface StructuredRequest {
  readonly prompt: string;
  readonly images?: readonly ImageInput[];
  /** Short identifier for the output format, e.g. "pantry_ingredients". */
  readonly schemaName: string;
  readonly schema: object;
  readonly effort: ReasoningEffort;
}

/** One prompt (+ optional photos) in, one JSON value matching the schema out. */
export interface StructuredModel {
  complete(request: StructuredRequest): Promise<unknown>;
}
