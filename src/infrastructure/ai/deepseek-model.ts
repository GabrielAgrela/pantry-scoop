import { AiUnavailableError } from '../../domain/errors.ts';
import type { FetchLike } from '../openai/openai-oauth-client.ts';
import type { ReasoningEffort } from '../openai/responses-client.ts';
import type { StructuredModel, StructuredRequest } from './structured-model.ts';

export interface DeepSeekSettings {
  readonly apiKey: string;
  /** e.g. "deepseek-flash" (DeepSeek-V4.1-Flash, reads photos). */
  readonly model: string;
  readonly timeoutMs: number;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
}

/** Thinking per request: 'minimal' turns it off; DeepSeek has no "medium", so it maps up to "high". */
function thinkingFor(effort: ReasoningEffort): object {
  if (effort === 'minimal') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: effort === 'low' ? 'low' : 'high' };
}

/**
 * A StructuredModel on DeepSeek's chat completions API with the server's own key. DeepSeek's JSON
 * mode does not enforce a schema, so the prompt states it and each answer is checked; a broken
 * answer is asked for once more before giving up.
 */
export class DeepSeekModel implements StructuredModel {
  private readonly settings: DeepSeekSettings;
  private readonly fetch: FetchLike;

  constructor(settings: DeepSeekSettings) {
    this.settings = settings;
    this.fetch = settings.fetch ?? ((input, init) => fetch(input, init));
  }

  async complete(request: StructuredRequest): Promise<unknown> {
    try {
      return await this.attempt(request);
    } catch (error) {
      if (!(error instanceof BrokenAnswerError)) throw error;
      return this.attempt(request);
    }
  }

  private async attempt(request: StructuredRequest): Promise<unknown> {
    const text = `${request.prompt}\n\nAnswer with only one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(request.schema)}`;
    const content: object[] = [{ type: 'text', text }];
    for (const image of request.images ?? []) {
      content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}` } });
    }
    const body = {
      model: this.settings.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      ...thinkingFor(request.effort),
    };

    let response: Response;
    try {
      response = await this.fetch(`${this.settings.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.settings.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      throw new AiUnavailableError(timedOut ? 'DeepSeek took too long to answer. Try again.' : 'Could not reach DeepSeek. Check the connection.');
    }

    const result = (await response.json().catch(() => ({}))) as ChatCompletion;
    switch (response.status) {
      case 200:
        break;
      case 401:
        throw new AiUnavailableError('Pantry Scoop’s DeepSeek key was refused. Ask the owner to check DEEPSEEK_API_KEY.');
      case 402:
        throw new AiUnavailableError('Pantry Scoop’s DeepSeek credit has run out. Ask the owner to top it up.');
      case 429:
        throw new AiUnavailableError('DeepSeek is busy right now. Try again in a minute.');
      case 500:
      case 503:
        throw new AiUnavailableError('DeepSeek is overloaded right now. Try again in a minute.');
      default:
        throw new AiUnavailableError(`DeepSeek could not answer (${response.status}${result.error?.message ? `: ${result.error.message}` : ''}). Try again.`);
    }

    const choice = result.choices?.[0];
    if (choice?.finish_reason === 'length') throw new AiUnavailableError('DeepSeek’s answer was cut off. Try again with fewer items.');
    let answer: unknown;
    try {
      answer = JSON.parse(choice?.message?.content ?? '');
    } catch {
      throw new BrokenAnswerError();
    }
    const required = (request.schema as { required?: string[] }).required ?? [];
    if (typeof answer !== 'object' || answer === null || required.some((key) => !(key in answer))) throw new BrokenAnswerError();
    return answer;
  }
}

class BrokenAnswerError extends AiUnavailableError {
  constructor() {
    super('DeepSeek gave an incomplete answer. Try again.');
  }
}
