import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createContainer } from '../../src/composition.ts';
import { loadConfig } from '../../src/config.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { ResponsesClient } from '../../src/infrastructure/openai/responses-client.ts';
import { FakeOpenAiAuth, TEST_CIPHER, TINY_JPEG } from '../fakes/fixtures.ts';

/** Wiring check: sign-in → photo scan → Responses API with that user's token → stock updated. */
describe('createContainer', () => {
  it('runs a scan on the signed-in user’s ChatGPT plan', async () => {
    const requests: { url: string; auth: string | undefined; body: Record<string, unknown> | undefined }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        auth: (init?.headers as Record<string, string>).authorization,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/models')) {
        return Response.json({ models: [{ slug: 'plan-model', display_name: 'Plan', visibility: 'list' }] });
      }
      const answer = JSON.stringify({ ingredients: [{ name: 'Manga', category: 'fruit' }] });
      const events = [
        { type: 'response.output_text.delta', delta: answer },
        { type: 'response.completed', response: {} },
      ];
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });
    };

    const openai = new FakeOpenAiAuth();
    const container = createContainer({
      config: loadConfig({ PORT: '4321' }),
      db: openDatabase(':memory:'),
      cipher: TEST_CIPHER,
      openaiAuth: openai,
      responses: new ResponsesClient({ fetch, timeoutMs: 1000 }),
    });

    const started = container.auth.startSignIn();
    assert.equal(openai.authorizeCalls[0]!.redirectUri, 'http://127.0.0.1:4321/auth/callback');
    const { user } = await container.auth.completeSignIn({
      params: openai.callbackParams(),
      bindingToken: started.bindingToken,
      trustedWithoutBinding: false,
    });

    const result = await container.forUser(user.id).scan.scan([TINY_JPEG]);

    assert.deepEqual(result.added.map((i) => i.name), ['Manga']);
    const inference = requests.find((r) => r.url.endsWith('/responses'))!;
    assert.equal(inference.auth, 'Bearer access-1');
    assert.equal(inference.body?.model, 'plan-model');
    assert.deepEqual(inference.body?.reasoning, { effort: 'low' });
  });
});
