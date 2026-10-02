import { AiUnavailableError, AuthRequiredError, UsageLimitError } from '../../domain/errors.ts';
import type { ImageInput } from '../../domain/image.ts';
import type { ModelOption } from '../../ports/model-catalog.ts';
import type { FetchLike } from './openai-oauth-client.ts';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface ResponsesRequest {
  readonly model: string;
  readonly prompt: string;
  readonly images?: readonly ImageInput[];
  readonly schemaName: string;
  /** JSON Schema in strict structured-output form (all keys required, no extras). */
  readonly schema: object;
  readonly effort?: ReasoningEffort;
}

export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

/**
 * Minimal Responses API client for "ChatGPT plan usage" tokens. The route requires
 * `store: false` and `stream: true`; success is only a `response.completed` event.
 */
export class ResponsesClient {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  /** Models that rejected the `reasoning` parameter; we stop sending it to them. */
  private readonly noReasoning = new Set<string>();

  constructor(options: { baseUrl?: string; fetch?: FetchLike; timeoutMs: number }) {
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs;
  }

  async listModels(accessToken: string): Promise<ModelOption[]> {
    const response = await this.send(`${this.baseUrl}/models`, { method: 'GET', headers: this.headers(accessToken) });
    if (!response.ok) throw await toError(response);
    const body = (await response.json()) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
    return (body.models ?? [])
      .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
      .map((model) => ({ slug: model.slug!, displayName: model.display_name || model.slug! }));
  }

  /** Runs one structured-output request and returns the parsed JSON answer. */
  async complete(accessToken: string, request: ResponsesRequest): Promise<unknown> {
    try {
      return await this.attempt(accessToken, request, !this.noReasoning.has(request.model));
    } catch (error) {
      if (error instanceof UnsupportedParameterError && error.param.startsWith('reasoning') && request.effort) {
        this.noReasoning.add(request.model);
        return this.attempt(accessToken, request, false);
      }
      throw error;
    }
  }

  private async attempt(accessToken: string, request: ResponsesRequest, withReasoning: boolean): Promise<unknown> {
    const content: object[] = [{ type: 'input_text', text: request.prompt }];
    for (const image of request.images ?? []) {
      content.push({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data.toString('base64')}`, detail: 'auto' });
    }
    const body = {
      model: request.model,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: true } },
      ...(withReasoning && request.effort ? { reasoning: { effort: request.effort } } : {}),
      store: false,
      stream: true,
    };
    const response = await this.send(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: { ...this.headers(accessToken), 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
    if (!response.ok || !response.body) throw await toError(response);
    return parseJsonAnswer(await readStream(response.body));
  }

  private headers(accessToken: string): Record<string, string> {
    return { authorization: `Bearer ${accessToken}` };
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      throw new AiUnavailableError(timedOut ? 'ChatGPT took too long to answer. Try again.' : 'Could not reach ChatGPT. Check the connection.');
    }
  }
}

class UnsupportedParameterError extends AiUnavailableError {
  readonly param: string;
  constructor(message: string, param: string) {
    super(message);
    this.param = param;
  }
}

interface ApiError {
  code?: string;
  param?: string;
  message?: string;
}

/** Maps documented plan-usage error codes to domain errors with a clear next step. */
export function errorFromApi(status: number, error: ApiError, requestId = ''): Error {
  const ref = requestId ? ` (request ${requestId})` : '';
  switch (error.code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new UsageLimitError('ChatGPT usage limit reached. Review your plan or this app’s limit in ChatGPT settings.');
    case 'subscription_sharing_user_not_eligible':
      return new AiUnavailableError('ChatGPT plan usage is not available for this account or workspace (Plus or Pro is required).');
    case 'subscription_sharing_invalid_user':
      return new AuthRequiredError('ChatGPT could not validate your account. Sign in again.');
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return new AiUnavailableError('ChatGPT is temporarily unavailable. Try again in a minute.');
    case 'subscription_sharing_unsupported_capability':
      return new UnsupportedParameterError(`ChatGPT rejected part of the request (${error.param ?? 'unknown'})${ref}.`, error.param ?? '');
  }
  if (status === 400 && error.param) {
    return new UnsupportedParameterError(`ChatGPT rejected the request: ${error.message ?? error.param}${ref}`, error.param);
  }
  if (status === 401) return new AuthRequiredError('Your ChatGPT connection is no longer valid. Sign in again.');
  if (status === 429) return new UsageLimitError('ChatGPT usage limit reached. Review your usage in ChatGPT settings.');
  if (status === 403) return new AiUnavailableError(`ChatGPT refused the request: ${error.message ?? 'not permitted'}${ref}`);
  return new AiUnavailableError(`ChatGPT request failed (${error.code ?? status})${ref}. Try again.`);
}

async function toError(response: Response): Promise<Error> {
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('openai-request-id') ?? '';
  const text = await response.text().catch(() => '');
  let error: ApiError = {};
  try {
    const parsed = JSON.parse(text) as { error?: ApiError; detail?: unknown };
    error = parsed.error ?? { message: typeof parsed.detail === 'string' ? parsed.detail : undefined };
  } catch {
    // not JSON
  }
  return errorFromApi(response.status, error, requestId);
}

interface StreamEvent {
  type?: string;
  delta?: string;
  text?: string;
  code?: string;
  message?: string;
  param?: string;
  response?: {
    error?: ApiError | null;
    incomplete_details?: { reason?: string } | null;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
}

/** Consumes a Responses SSE stream; returns the output text only after `response.completed`. */
export async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let completed = false;

  const handle = (event: StreamEvent) => {
    switch (event.type) {
      case 'response.output_text.delta':
        text += event.delta ?? '';
        break;
      case 'response.output_text.done':
        text = event.text ?? text;
        break;
      case 'response.completed':
        completed = true;
        if (!text) {
          text = (event.response?.output ?? [])
            .flatMap((item) => item.content ?? [])
            .filter((part) => part.type === 'output_text')
            .map((part) => part.text ?? '')
            .join('');
        }
        break;
      case 'response.failed':
        throw errorFromApi(0, event.response?.error ?? {});
      case 'response.incomplete':
        throw new AiUnavailableError(`ChatGPT stopped early (${event.response?.incomplete_details?.reason ?? 'incomplete'}). Try again.`);
      case 'error':
        throw errorFromApi(0, { code: event.code, message: event.message, param: event.param });
    }
  };

  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary: number;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') handle(JSON.parse(data) as StreamEvent);
    }
    if (done) break;
  }
  if (!completed) throw new AiUnavailableError('The ChatGPT answer was cut off. Try again.');
  return text;
}

function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') throw new AiUnavailableError('ChatGPT returned an empty answer.');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AiUnavailableError('ChatGPT answered with invalid JSON.');
  }
}
