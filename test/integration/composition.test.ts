import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createContainer } from '../../src/composition.ts';
import { loadConfig } from '../../src/config.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { ResponsesClient } from '../../src/infrastructure/openai/responses-client.ts';
import { FakeGoogleAuth, FakeOpenAiAuth, googleIdentity, TEST_CIPHER, TINY_JPEG } from '../fakes/fixtures.ts';

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

  it('runs DeepSeek for a Google-only account, and each person’s choice otherwise', async () => {
    const deepseekCalls: { schema: string; effort: string }[] = [];
    const deepseek = {
      complete: async (request: { schemaName: string; effort: string }) => {
        deepseekCalls.push({ schema: request.schemaName, effort: request.effort });
        if (request.schemaName === 'pantry_classification') return { assignments: [] };
        return { ingredients: [{ name: 'Arroz', category: 'grains' }] };
      },
    };
    const planCalls: string[] = [];
    const fetch = async (url: string) => {
      planCalls.push(url);
      if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'plan-model', display_name: 'Plan', visibility: 'list' }] });
      const answer = JSON.stringify({ ingredients: [{ name: 'Manga', category: 'fruit' }] });
      return new Response(
        [{ type: 'response.output_text.delta', delta: answer }, { type: 'response.completed', response: {} }]
          .map((e) => `data: ${JSON.stringify(e)}\n\n`)
          .join(''),
      );
    };
    const openai = new FakeOpenAiAuth();
    const google = new FakeGoogleAuth();
    const container = createContainer({
      config: loadConfig({ PUBLIC_URL: 'https://pantry.example.com', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' }),
      db: openDatabase(':memory:'),
      cipher: TEST_CIPHER,
      openaiAuth: openai,
      responses: new ResponsesClient({ fetch, timeoutMs: 1000 }),
      googleAuth: google,
      deepseek,
    });

    // Google-only (e.g. a free ChatGPT plan): automatic picks DeepSeek, with thinking set per task.
    google.nextIdentity = googleIdentity('g-1', 'free@example.com');
    const g = container.auth.startGoogleSignIn();
    assert.equal(google.authorizeCalls[0]!.redirectUri, 'https://pantry.example.com/auth/google/callback');
    const { user: free } = await container.auth.completeGoogleSignIn({ params: google.callbackParams(), bindingToken: g.bindingToken });
    const services = container.forUser(free.id);
    assert.deepEqual((await services.scan.scan([TINY_JPEG])).added.map((i) => i.name), ['Arroz']);
    services.stock.addManual({ name: 'Mystery jar' });
    await services.classification.classifyOther().catch(() => undefined);
    assert.equal(container.connections.view(free.id).aiProvider, 'deepseek');
    assert.deepEqual(deepseekCalls.map((c) => `${c.schema}:${c.effort}`), ['pantry_ingredients:high', 'pantry_classification:minimal']);

    // ChatGPT plan: automatic uses the plan; choosing DeepSeek switches, choosing ChatGPT switches back.
    const c = container.auth.startSignIn();
    const { user: plus } = await container.auth.completeSignIn({ params: openai.callbackParams(), bindingToken: c.bindingToken, trustedWithoutBinding: false });
    await container.forUser(plus.id).scan.scan([TINY_JPEG]);
    assert.equal(planCalls.filter((u) => u.endsWith('/responses')).length, 1);
    container.connections.setAiChoice(plus.id, 'deepseek');
    await container.forUser(plus.id).scan.scan([TINY_JPEG]);
    assert.equal(deepseekCalls.length, 3);
    container.connections.setAiChoice(plus.id, 'chatgpt');
    await container.forUser(plus.id).scan.scan([TINY_JPEG]);
    assert.equal(planCalls.filter((u) => u.endsWith('/responses')).length, 2);
    assert.equal(container.auth.googleEnabled, true);
    // Every AI request, whichever intelligence runs it, counts towards the daily limit.
    assert.equal(container.aiLimit.view(plus.id).used, 3);
    assert.equal(container.aiLimit.view(free.id).used, 2);
  });
});
