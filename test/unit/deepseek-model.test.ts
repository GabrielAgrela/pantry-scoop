import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiUnavailableError } from '../../src/domain/errors.ts';
import { DeepSeekModel } from '../../src/infrastructure/ai/deepseek-model.ts';

type Call = { url: string; headers: Record<string, string>; body: Record<string, any> };

function model(...responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return (responses[calls.length - 1] ?? responses.at(-1)!)();
  };
  return { calls, deepseek: new DeepSeekModel({ apiKey: 'key-1', model: 'deepseek-flash', timeoutMs: 1000, fetch }) };
}

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const request = { prompt: 'Find food', schemaName: 'pantry', schema, effort: 'high' as const };
const answer = (content: string | null, finish = 'stop') => () => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });

describe('DeepSeekModel', () => {
  it('sends the prompt with its schema, photos, JSON mode and the key, and returns the answer', async () => {
    const { calls, deepseek } = model(answer('{"ok":true}'));
    const result = await deepseek.complete({ ...request, images: [{ mimeType: 'image/jpeg', data: Buffer.from('jpg') }] });

    assert.deepEqual(result, { ok: true });
    const [call] = calls;
    assert.equal(call!.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(call!.headers.authorization, 'Bearer key-1');
    assert.equal(call!.body.model, 'deepseek-flash');
    assert.deepEqual(call!.body.response_format, { type: 'json_object' });
    const [text, image] = call!.body.messages[0].content;
    assert.equal(text.type, 'text');
    assert.ok(text.text.startsWith('Find food'));
    assert.ok(text.text.includes(JSON.stringify(schema)));
    assert.deepEqual(image, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` } });
  });

  it('maps effort to thinking: minimal = off, low = low, medium and high = high', async () => {
    const expected: [string, object][] = [
      ['minimal', { thinking: { type: 'disabled' } }],
      ['low', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }],
      ['medium', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }],
      ['high', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }],
    ];
    for (const [effort, thinking] of expected) {
      const { calls, deepseek } = model(answer('{"ok":true}'));
      await deepseek.complete({ ...request, effort: effort as 'low' });
      const { thinking: t, reasoning_effort: r } = calls[0]!.body;
      assert.deepEqual(r === undefined ? { thinking: t } : { thinking: t, reasoning_effort: r }, thinking, effort);
    }
  });

  it('asks once more after a broken or incomplete answer', async () => {
    for (const broken of [answer('{"ok": tr'), answer('{"other":1}'), answer(null)]) {
      const { calls, deepseek } = model(broken, answer('{"ok":false}'));
      assert.deepEqual(await deepseek.complete(request), { ok: false });
      assert.equal(calls.length, 2);
    }
    const { calls, deepseek } = model(answer('nope'));
    await assert.rejects(deepseek.complete(request), /incomplete answer/);
    assert.equal(calls.length, 2);
  });

  it('explains a refused key, empty credit, busy or overloaded service, cut-off answers and other errors', async () => {
    const cases: [() => Response, RegExp][] = [
      [() => Response.json({ error: { message: 'Authentication Fails' } }, { status: 401 }), /DEEPSEEK_API_KEY/],
      [() => Response.json({ error: { message: 'Insufficient Balance' } }, { status: 402 }), /credit has run out/],
      [() => Response.json({}, { status: 429 }), /busy/],
      [() => Response.json({}, { status: 503 }), /overloaded/],
      [() => Response.json({ error: { message: 'Invalid model' } }, { status: 400 }), /400: Invalid model/],
      [answer('{"ok":', 'length'), /cut off/],
    ];
    for (const [response, message] of cases) {
      const { calls, deepseek } = model(response);
      await assert.rejects(deepseek.complete(request), (error: unknown) => error instanceof AiUnavailableError && message.test(error.message));
      assert.equal(calls.length, 1, String(message));
    }
  });
});
