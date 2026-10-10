import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createKokoroVoice } from '../../public/js/kokoro-voice.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function player(request) {
  const buffers = [], sources = [], timers = new Map(); let closed = 0, context, timerId = 0;
  class Context {
    constructor() { context = this; }
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    close() { closed++; return Promise.resolve(); }
    createBuffer(_channels, samples, rate) {
      const data = new Float32Array(samples);
      const buffer = { data, duration: samples / rate, getChannelData: () => data };
      buffers.push(buffer); return buffer;
    }
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, connect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source;
    }
  }
  const voice = createKokoroVoice({ capabilities: async () => ({ listening: true }), listen: options => options },
    { AudioContext: Context, ReadableStream, AbortController,
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, time: context.currentTime + delay / 1000 }); return id; },
      clearTimeout(id) { timers.delete(id); },
    }, request);
  return { voice, buffers, sources, get closed() { return closed; },
    advance(time) {
      context.currentTime = time;
      for (const [id, timer] of [...timers]) if (timer.time <= time) { timers.delete(id); timer.callback(); }
    },
  };
}

it('starts PCM before EOF, preserves odd-byte boundaries and waits for playback to finish', async () => {
  let upstream, started = 0, ended = 0;
  const stream = new ReadableStream({ start(controller) { upstream = controller; } });
  const page = player(async () => new Response(stream, { headers: { 'Content-Type': 'audio/pcm; rate=24000; channels=1' } }));
  page.voice.speak({ text: 'Hello', onStart: () => started++, onEnd: () => ended++, onError: error => { throw error; } });
  upstream.enqueue(new Uint8Array([0, 64, 0])); await tick();
  assert.equal(started, 0); assert.equal(ended, 0); assert.equal(page.buffers[0].data[0], 0.5);
  upstream.enqueue(new Uint8Array([192])); await tick();
  assert.equal(page.buffers[1].data[0], -0.5);
  assert.ok(page.sources[1].time >= page.sources[0].time + page.buffers[0].duration / page.sources[0].playbackRate.value);
  page.advance(0.061); assert.equal(started, 1);
  upstream.close(); await tick(); assert.equal(ended, 0);
  page.sources[0].onended(); page.sources[1].onended(); await tick();
  assert.equal(ended, 1); assert.equal(page.closed, 1);
});

it('cancels network and queued audio without late callbacks', async () => {
  let upstream, signal, cancelled = 0, callbacks = 0;
  const page = player(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(c) { upstream = c; }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'audio/pcm' } });
  });
  const session = page.voice.speak({ text: 'Hello', onStart: () => callbacks++, onEnd: () => callbacks++, onError: () => callbacks++ });
  await tick(); upstream.enqueue(new Uint8Array([0, 64])); await tick(); session.cancel(); await tick();
  page.advance(1);
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1); assert.equal(page.sources[0].stopped, true);
  assert.equal(page.closed, 1); assert.equal(callbacks, 0);
});

it('announces playback at the first audible sample, after leading silence', async () => {
  let upstream, started = 0;
  const page = player(async () => new Response(new ReadableStream({ start(c) { upstream = c; } }),
    { headers: { 'Content-Type': 'audio/pcm' } }));
  const session = page.voice.speak({ text: 'Hello', onStart: () => started++, onEnd() {}, onError: error => { throw error; } });
  await tick();
  upstream.enqueue(new Uint8Array(24000)); await tick();
  page.advance(0.1); assert.equal(started, 0);
  const next = new Uint8Array(24000); next[2001] = 64; // Speech begins 1,000 samples into the second buffer.
  upstream.enqueue(next); await tick();
  const audibleTime = page.sources[1].time + 1000 / (24000 * page.sources[1].playbackRate.value);
  page.advance(audibleTime - 0.001); assert.equal(started, 0);
  page.advance(audibleTime + 0.011); assert.equal(started, 1);
  session.cancel(); page.advance(5); assert.equal(started, 1);
});

it('refills a long stream while audio is still queued instead of draining the queue', async () => {
  let upstream;
  const page = player(async () => new Response(new ReadableStream({ start(c) { upstream = c; } }),
    { headers: { 'Content-Type': 'audio/pcm' } }));
  const session = page.voice.speak({ text: 'Long reply', onEnd() {}, onError: error => { throw error; } });
  await tick();
  upstream.enqueue(new Uint8Array(24000 * 10)); await tick();
  const initiallyQueued = page.sources.length;
  assert.ok(initiallyQueued > 2 && initiallyQueued < 10);
  const first = page.sources[0], duration = first.buffer.duration / first.playbackRate.value;
  page.advance(first.time + duration); first.onended(); await tick();
  assert.ok(page.sources.length > initiallyQueued && page.sources.length < 10);
  const previous = page.sources[initiallyQueued - 1], added = page.sources[initiallyQueued];
  assert.equal(added.time, previous.time + duration);
  // The next buffer was added with several unfinished buffers still ahead of it.
  assert.ok(added.time - (first.time + duration) > 1);
  session.cancel();
});

it('raises the cartoon pitch while scheduling streamed chunks without gaps or overlaps', async () => {
  let upstream, ended = 0;
  const page = player(async () => new Response(new ReadableStream({ start(c) { upstream = c; } }),
    { headers: { 'Content-Type': 'audio/pcm' } }));
  page.voice.speak({ text: 'Cartoon Scoop', onEnd: () => ended++, onError: error => { throw error; } });
  await tick();
  // Each half-second buffer arrives separately, before the response is complete.
  upstream.enqueue(new Uint8Array(24000)); await tick();
  upstream.enqueue(new Uint8Array(24000)); await tick();
  assert.equal(page.sources.length, 2); assert.equal(ended, 0);
  const rate = page.sources[0].playbackRate.value;
  assert.ok(Math.abs(12 * Math.log2(rate) - 4) < 1e-10);
  assert.equal(page.sources[1].playbackRate.value, rate);
  assert.ok(Math.abs(page.sources[1].time - (page.sources[0].time + 0.5 / rate)) < 1e-10);
  upstream.close(); await tick();
  page.sources[0].onended(); await tick(); assert.equal(ended, 0);
  page.sources[1].onended(); await tick(); assert.equal(ended, 1);
});

it('reports server, format, empty and truncated-audio failures without using device speech', async () => {
  for (const response of [
    new Response(JSON.stringify({ error: 'Please sign in.' }), { status: 401 }),
    new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array(), { headers: { 'Content-Type': 'audio/pcm' } }),
    new Response(new Uint8Array([0]), { headers: { 'Content-Type': 'audio/pcm' } }),
  ]) {
    const page = player(async () => response); let errors = 0, ended = 0;
    page.voice.speak({ text: 'Hello', onError: () => errors++, onEnd: () => ended++ }); await tick();
    assert.equal(errors, 1); assert.equal(ended, 1); assert.equal(page.closed, 1);
  }
});

it('cancellation while awaiting response never schedules audio', async () => {
  let respond, callbacks = 0;
  const page = player(() => new Promise(resolve => { respond = resolve; }));
  const session = page.voice.speak({text:'Hello',onEnd:()=>callbacks++,onError:()=>callbacks++});
  await tick(); session.cancel();
  respond(new Response(new Uint8Array([0,64]), {headers:{'Content-Type':'audio/pcm'}})); await tick();
  assert.equal(page.sources.length, 0); assert.equal(callbacks, 0);
});

it('keeps browser dictation and advertises only configured server speech', async () => {
  const page = player(async () => new Response(JSON.stringify({ speaking: false })));
  assert.deepEqual(await page.voice.capabilities(), { listening: true, speaking: false });
  assert.equal(page.voice.fixedVoice, 'Heart');
});

it('unlocks audio before the asynchronous reply without requesting speech and reuses that context', async () => {
  let created = 0, requests = 0, gestures = true, contexts = [];
  class Context {
    state = 'suspended'; currentTime = 0; destination = {};
    constructor() { created++; contexts.push(this); }
    resume() { if(gestures) this.state='running'; return this.state==='running' ? Promise.resolve() : Promise.reject(new Error('No gesture')); }
    close() { this.state='closed'; return Promise.resolve(); }
    createBuffer(_channels,n,rate) {return {duration:n/rate,getChannelData:()=>new Float32Array(n)};}
    createBufferSource() {const context=this;return {playbackRate:{value:1},connect(){},start(){context.source=this;},stop(){this.onended?.();}};}
  }
  const voice=createKokoroVoice({capabilities:async()=>({listening:true})},{AudioContext:Context,ReadableStream,AbortController},async()=>{
    requests++; return new Response(new Uint8Array([0,64]),{headers:{'Content-Type':'audio/pcm'}});
  });
  await voice.prepare(); assert.equal(requests,0); gestures=false;
  let ended=0; voice.speak({text:'Later reply',onEnd:()=>ended++,onError:error=>{throw error;}}); await tick();
  assert.equal(created,1); assert.equal(requests,1); contexts[0].source.onended();await tick();assert.equal(ended,1);
});

it('cancels before resume completes without sending a TTS request', async () => {
  let resolve, requests=0;
  class Context {resume(){return new Promise(r=>{resolve=r;});}close(){return Promise.resolve();}}
  const voice=createKokoroVoice({}, {AudioContext:Context,ReadableStream,AbortController}, async()=>{requests++;});
  const session=voice.speak({text:'Cancelled reply',onEnd(){},onError(){}});session.cancel();resolve();await tick();assert.equal(requests,0);
});
