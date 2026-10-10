import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { it } from 'node:test';
import { speechChunks } from '../../public/js/voice.js';

const source = readFileSync(new URL('../../mobile/voice.js', import.meta.url), 'utf8')
  .replace("import { speechChunks } from '/js/voice.js';", '').replace('export function', 'function');
const createNativeVoice = runInNewContext(`${source}\ncreateNativeVoice`, { speechChunks, Error });
const tick = () => new Promise(resolve => setImmediate(resolve));

it('removes the native listener if chat closes before the bridge finishes attaching it', async () => {
  let attach, removed = 0, started = 0, cancelled = 0;
  const voice = createNativeVoice({
    addListener: () => new Promise(resolve => { attach = resolve; }),
    startListening: async () => started++, cancelListening: async () => cancelled++,
  });
  const session = voice.listen({ lang: 'en', onStart() {}, onResult() {}, onError() { assert.fail('late error'); }, onEnd() { assert.fail('late end'); } });
  session.cancel(); attach({ remove: async () => removed++ }); await tick();
  assert.equal(started, 0); assert.equal(removed, 1); assert.equal(cancelled, 1);
});

it('passes native transcripts through and restores the composer after a permission error', async () => {
  let listener, removed = 0, ended = 0;
  const texts = [], errors = [];
  const voice = createNativeVoice({
    addListener: async (name, handler) => { listener = handler; return { remove: () => removed++ }; },
    startListening: async () => {},
  });
  voice.listen({ lang: 'en', onStart() {}, onResult: text => texts.push(text), onError: error => errors.push(error.message), onEnd: () => ended++ });
  await tick();
  listener({type:'result',text:'Swap the cream?'});
  listener({type:'error',message:'Microphone access was denied.'}); listener({type:'end'});
  listener({type:'result',text:'late result'});
  assert.deepEqual(texts, ['Swap the cream?']); assert.match(errors[0], /denied/);
  assert.equal(ended, 1); assert.equal(removed, 1);
});

it('stops native TTS without queuing the rest of a long reply', async () => {
  let complete, stopped = 0, ended = 0;
  const spoken = [];
  const voice = createNativeVoice({ speak: ({text}) => { spoken.push(text); return new Promise(resolve => complete = resolve); }, stopSpeaking: async () => stopped++ });
  const session = voice.speak({ text:'Use oat cream. '.repeat(300), lang:'en', onError() { assert.fail('late error'); }, onEnd: () => ended++ });
  session.cancel(); complete(); await tick();
  assert.equal(spoken.length, 1); assert.equal(stopped, 1); assert.equal(ended, 0);
});
