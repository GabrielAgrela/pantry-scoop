import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiUnavailableError, AuthRequiredError, UsageLimitError } from '../../src/domain/errors.ts';
import { errorFromApi, readStream, ResponsesClient } from '../../src/infrastructure/openai/responses-client.ts';
import { TINY_JPEG } from '../fakes/fixtures.ts';

const sse = (...events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** Splits the payload into small chunks to exercise buffering across reads. */
function stream(text: string, chunk = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
}

const answer = (json: unknown) =>
  sse(
    { type: 'response.created' },
    ...JSON.stringify(json).match(/.{1,5}/g)!.map((delta) => ({ type: 'response.output_text.delta', delta })),
    { type: 'response.completed', response: {} },
  );

function fakeFetch(responses: { status: number; body: string; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift()!;
    return new Response(next.status === 200 && next.body.startsWith('event:') ? stream(next.body) : next.body, {
      status: next.status,
      headers: next.headers,
    });
  };
  return { fetch, calls };
}

const request = { model: 'gpt-x', prompt: 'List it', schemaName: 'out', schema: { type: 'object' }, effort: 'low' as const };

describe('readStream', () => {
  it('joins deltas and requires response.completed', async () => {
    assert.equal(await readStream(stream(answer({ a: 1 }))), '{"a":1}');
    await assert.rejects(readStream(stream(sse({ type: 'response.output_text.delta', delta: '{}' }))), /cut off/);
  });

  it('falls back to the output items when no deltas were streamed', async () => {
    const text = await readStream(stream(sse({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: '{"b":2}' }] }] } })));
    assert.equal(text, '{"b":2}');
  });

  it('surfaces failures that arrive mid-stream', async () => {
    const limit = sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } });
    await assert.rejects(readStream(stream(limit)), UsageLimitError);
    await assert.rejects(readStream(stream(sse({ type: 'response.failed', response: { id: 'resp_9', error: { code: 'server_error', message: 'The model had a problem.' } } }))),
      { message: 'ChatGPT request failed (server_error): The model had a problem (request resp_9). Try again.' });
    await assert.rejects(readStream(stream(sse({ type: 'error', message: 'Invalid schema for response_format' }))), { message: 'ChatGPT request failed: Invalid schema for response_format. Try again.' });
    await assert.rejects(readStream(stream(sse({ type: 'error', error: { code: 'invalid_json_schema', message: 'Bad schema' } }))), /\(invalid_json_schema\): Bad schema/);
    await assert.rejects(readStream(stream(sse({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }))), /max_output_tokens/);
  });
});

describe('ResponsesClient.complete', () => {
  it('sends a plan-usage compatible structured-output request with images', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: answer({ ingredients: [] }) }]);
    const result = await new ResponsesClient({ fetch, timeoutMs: 1000 }).complete('token-1', { ...request, images: [TINY_JPEG] });

    assert.deepEqual(result, { ingredients: [] });
    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/responses');
    assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'Bearer token-1');
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.deepEqual(body.text.format, { type: 'json_schema', name: 'out', schema: { type: 'object' }, strict: true });
    assert.deepEqual(body.input[0].content[1], { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/2Q==', detail: 'auto' });
    for (const banned of ['temperature', 'max_output_tokens', 'previous_response_id', 'metadata', 'user']) assert.equal(banned in body, false);
  });

  it('retries without reasoning when the model rejects it, and remembers that', async () => {
    const rejected = { status: 400, body: JSON.stringify({ error: { code: 'subscription_sharing_unsupported_capability', param: 'reasoning.effort' } }) };
    const { fetch, calls } = fakeFetch([rejected, { status: 200, body: answer({}) }, { status: 200, body: answer({}) }]);
    const client = new ResponsesClient({ fetch, timeoutMs: 1000 });
    await client.complete('t', request);
    await client.complete('t', request);
    const sent = calls.map((c) => 'reasoning' in JSON.parse(String(c.init.body)));
    assert.deepEqual(sent, [true, false, false]);
  });

  it('maps admission errors', async () => {
    const run = (status: number, body: unknown) =>
      new ResponsesClient({ fetch: fakeFetch([{ status, body: JSON.stringify(body) }]).fetch, timeoutMs: 1000 }).complete('t', request);
    await assert.rejects(run(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } }), UsageLimitError);
    await assert.rejects(run(401, { detail: 'bad token' }), AuthRequiredError);
    await assert.rejects(run(503, { detail: 'down' }), AiUnavailableError);
  });

  it('reports invalid JSON and timeouts as AI failures', async () => {
    const bad = sse({ type: 'response.output_text.delta', delta: 'not json' }, { type: 'response.completed' });
    await assert.rejects(new ResponsesClient({ fetch: fakeFetch([{ status: 200, body: bad }]).fetch, timeoutMs: 1000 }).complete('t', request), /invalid JSON/);

    // A real socket keeps the event loop alive while waiting; this fake must do so explicitly.
    const slow = async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const keepAlive = setTimeout(() => {}, 5000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(init.signal!.reason);
        });
      });
    await assert.rejects(new ResponsesClient({ fetch: slow, timeoutMs: 20 }).complete('t', request), /took too long/);
  });
});

describe('ResponsesClient.listModels', () => {
  it('keeps only listed models in server order', async () => {
    const body = JSON.stringify({ models: [
      { slug: 'b', display_name: 'B', visibility: 'list' },
      { slug: 'hidden', visibility: 'hide' },
      { slug: 'a', visibility: 'list' },
    ] });
    const models = await new ResponsesClient({ fetch: fakeFetch([{ status: 200, body }]).fetch, timeoutMs: 1000 }).listModels('t');
    assert.deepEqual(models, [{ slug: 'b', displayName: 'B' }, { slug: 'a', displayName: 'a' }]);
  });
});

describe('errorFromApi', () => {
  it('maps documented plan-usage codes', () => {
    assert.ok(errorFromApi(403, { code: 'subscription_sharing_user_not_eligible' }) instanceof AiUnavailableError);
    assert.ok(errorFromApi(401, { code: 'subscription_sharing_invalid_user' }) instanceof AuthRequiredError);
    assert.match(errorFromApi(500, {}, 'req_1').message, /req_1/);
  });
});
