import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildApp } from '../../src/http/app.ts';
import { KokoroSpeech, speechSegments } from '../../src/infrastructure/ai/kokoro-speech.ts';
import { buildTestContainer } from '../fakes/fixtures.ts';

it('requests only Kokoro Heart PCM and hides upstream credentials/errors', async () => {
  let payload: Record<string, unknown> | undefined;
  const request: typeof fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(new Uint8Array([0, 64]), { headers: { 'Content-Type': 'audio/pcm; rate=24000; channels=1' } });
  };
  const speech = new KokoroSpeech('test-secret', request);
  assert.ok(await speech.synthesize('Hello', new AbortController().signal));
  assert.deepEqual(payload, { model:'hexgrad/kokoro-82m',voice:'af_heart',input:'Hello',response_format:'pcm',provider:{options:{deepinfra:{extra_body:{stream:true,sample_rate:24000}}}} });
  for (const response of [new Response('test-secret', { status:401 }), new Response('test-secret', {headers:{'Content-Type':'application/json'}}), new Response('xx',{headers:{'Content-Type':'audio/pcm; rate=48000'}})]) {
    await assert.rejects(new KokoroSpeech('test-secret', async () => response).synthesize('Hi',new AbortController().signal), error => !String(error).includes('test-secret'));
  }
});

it('keeps complete sentences, conjunctions and measurements together without hard word cuts', () => {
  for (const text of ['Use 1.5 tbsp sugar and 200 ml milk. Then stir gently. '.repeat(40), 'x'.repeat(6000)]) {
    const parts = speechSegments(text);
    assert.equal(parts.join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
    if (text.includes('.')) assert.ok(parts.every(part => part.endsWith('.')));
    else assert.deepEqual(parts, [text]);
  }
  assert.deepEqual(speechSegments('Use 1.5 tbsp sugar.'), ['Use 1.5 tbsp sugar.']);
  const sentence = 'Yes, the oil is nice and is probably okay for this recipe, especially when you use a small amount and mix it with the other ingredients until everything is smooth.';
  assert.deepEqual(speechSegments(sentence), [sentence]);
  const measurements = 'Use 1.5 tbsp. olive oil, e.g. extra virgin, and 200 ml milk with 1,000 g flour.';
  assert.deepEqual(speechSegments(measurements), [measurements]);
  assert.deepEqual(speechSegments('First stir the cream and milk gently until everything is smooth. '.repeat(8)).flatMap(part => [...part.matchAll(/First stir[^.]+\./g)].map(match => match[0])),
    Array(8).fill('First stir the cream and milk gently until everything is smooth.'));
});

it('splits an unusually long sentence only at a marked clause and keeps lists intact', () => {
  const first = 'Use olive oil, milk, sugar, cream and flour, mixing slowly until the ingredients are completely combined and smooth';
  const second = 'but keep the heat low while you stir the mixture until it becomes thick enough to coat the back of a spoon and the edges are starting to bubble gently';
  const text = `${first}, ${second}, then remove the pan from the heat and let it cool completely before serving.`;
  const parts = speechSegments(text);
  assert.equal(parts[0], first + ',');
  assert.ok(parts[1]!.startsWith('but keep'));
  assert.equal(parts.join(' '), text);
  assert.ok(parts.every(part => !/\b(?:and|but|because|while)$/.test(part)));
});

it('streams the opening section while the next generation is pending and bounds prefetch', async () => {
  const text = 'A short first sentence. ' + 'Stir in the cream and milk until everything is smooth. '.repeat(8);
  const calls: { input: string; signal: AbortSignal }[] = [];
  let first!: ReadableStreamDefaultController<Uint8Array>, resolveNext!: (response: Response) => void;
  const speech = new KokoroSpeech('test-secret', async (_url, options) => {
    calls.push({ input: JSON.parse(String(options?.body)).input, signal: options!.signal as AbortSignal });
    if (calls.length === 1) return new Response(new ReadableStream({ start(c) { first = c; } }), { headers: { 'Content-Type': 'audio/pcm' } });
    if (calls.length === 2) return await new Promise<Response>(resolve => { resolveNext = resolve; });
    return new Response(new Uint8Array([1, 0]), { headers: { 'Content-Type': 'audio/pcm' } });
  });
  const audio = await speech.synthesize(text, new AbortController().signal);
  const reader = audio.getReader();
  first.enqueue(new Uint8Array([0, 64]));
  assert.deepEqual([...(await reader.read()).value!], [0, 64]);
  assert.equal(calls.length, 2); // The opening audio is usable before the next response exists.
  first.close();
  const following = reader.read();
  resolveNext(new Response(new Uint8Array([0, 192]), { headers: { 'Content-Type': 'audio/pcm' } }));
  assert.deepEqual([...(await following).value!], [0, 192]);
  assert.equal(calls.length, 3);
  const received = [0, 64, 0, 192];
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; received.push(...chunk.value!); }
  assert.deepEqual(calls.map(call => call.input), speechSegments(text));
  assert.equal(received.length, calls.length * 2);
  assert.ok(calls.every(call => call.signal.aborted));
});

it('cancels both the active generation and prefetched speech without requesting later sections', async () => {
  const signals: AbortSignal[] = [];
  let cancelled = 0;
  const speech = new KokoroSpeech('test-secret', async (_url, options) => {
    signals.push(options!.signal as AbortSignal);
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'Content-Type': 'audio/pcm' } });
  });
  const stream = await speech.synthesize('Stir gently. '.repeat(50), new AbortController().signal);
  await stream.cancel();
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted)); assert.equal(cancelled, 2);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(signals.length, 2);
});

it('reports a failed prefetched section instead of silently finishing a partial reply', async () => {
  let requests = 0;
  const speech = new KokoroSpeech('test-secret', async () => ++requests === 1
    ? new Response(new Uint8Array([0, 64]), { headers: { 'Content-Type': 'audio/pcm' } })
    : new Response('test-secret', { status: 503 }));
  const stream = await speech.synthesize('Stir the cream gently. '.repeat(15), new AbortController().signal);
  const reader = stream.getReader();
  assert.deepEqual([...(await reader.read()).value!], [0, 64]);
  await assert.rejects(reader.read(), error => String(error).includes('temporarily unavailable') && !String(error).includes('test-secret'));
  assert.equal(requests, 2);
});

describe('signed-in streaming speech', () => {
  let ctx: ReturnType<typeof buildTestContainer>, app: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  let calls: string[], pending: ReadableStreamDefaultController<Uint8Array> | undefined, signal: AbortSignal;
  beforeEach(async () => {
    calls = []; pending = undefined; ctx = buildTestContainer(Date.now);
    app = await buildApp(ctx.container, { speech: { async synthesize(text, abort) {
      calls.push(text); signal = abort;
      return new ReadableStream<Uint8Array>({ start(controller) { pending = controller; controller.enqueue(new Uint8Array([0,64])); } });
    } } });
    const start = await app.inject({url:'/auth/chatgpt/start'});
    const done = await app.inject({url:'/auth/callback?'+ctx.openai.callbackParams(),cookies:{ps_signin:start.cookies.find(c=>c.name==='ps_signin')!.value}});
    cookie = done.cookies.find(c=>c.name==='ps_session')!.value;
  });
  afterEach(async () => { app.server.closeAllConnections(); await app.close(); ctx.db.close(); });

  it('validates authentication, cross-site requests and text before synthesis', async () => {
    assert.equal((await app.inject({method:'POST',url:'/api/speech',payload:{text:'Hello'}})).statusCode,401);
    for (const text of ['', ' ', 'x'.repeat(6001), 123]) assert.equal((await app.inject({method:'POST',url:'/api/speech',cookies:{ps_session:cookie},payload:{text}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/speech',cookies:{ps_session:cookie},headers:{origin:'https://other.example'},payload:{text:'Hi'}})).statusCode,403);
    assert.equal(calls.length,0);
    assert.equal((await app.inject({url:'/api/speech/capabilities',cookies:{ps_session:cookie}})).json().speaking,true);
  });

  it('delivers bytes before upstream EOF and aborts when the browser disconnects', { timeout: 5000 }, async () => {
    const address = await app.listen({host:'127.0.0.1',port:0});
    const controller = new AbortController();
    const response = await fetch(address+'/api/speech',{method:'POST',headers:{cookie:'ps_session='+cookie,'content-type':'application/json'},body:JSON.stringify({text:' Hello '}),signal:controller.signal});
    assert.equal(response.status,200); assert.equal(response.headers.get('x-accel-buffering'),'no');
    assert.match(response.headers.get('content-type')!,/audio\/pcm/);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.deepEqual([...first.value!],[0,64]); assert.deepEqual(calls,['Hello']);
    const cancelled = new Promise(resolve => signal.addEventListener('abort',resolve,{once:true}));
    controller.abort(); await reader.cancel().catch(() => {}); await cancelled; assert.equal(signal.aborted,true);
  });

  it('completes the stream with cache disabled', { timeout: 5000 }, async () => {
    const result = app.inject({method:'POST',url:'/api/speech',cookies:{ps_session:cookie},payload:{text:'Hi'}}).then(response => response);
    while (!pending) await new Promise(resolve=>setImmediate(resolve));
    pending.enqueue(new Uint8Array([0,192])); pending.close();
    const response = await result; assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store'); assert.deepEqual([...response.rawPayload],[0,64,0,192]);
  });
});
