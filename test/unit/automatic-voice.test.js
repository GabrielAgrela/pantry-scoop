import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createAutomaticVoice } from '../../public/js/automatic-voice.js';

function page(values = new Map()) {
  const calls = [], errors = []; let prepared = 0, released = 0, visible = true;
  const env = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
  const voice = {
    prepare() { prepared++; }, release() { released++; },
    speak(options) { const call = { options, cancelled: false }; calls.push(call); return { cancel() { call.cancelled = true; } }; },
  };
  const options = {env, allowed:()=>visible,onError:error=>errors.push(error)};
  return { voice, options, output:createAutomaticVoice(voice,options), calls, values, errors,
    get prepared() { return prepared; }, get released() { return released; }, hide() { visible = false; } };
}

it('holds reply readiness until playback actually starts', async () => {
  const p = page(); let revealed = false;
  const ready = p.output.speak('Hold this reply', 'en').then(status => { revealed = true; return status; });
  await Promise.resolve(); assert.equal(revealed, false);
  p.calls[0].options.onStart(); assert.equal(await ready, 'started');
  p.calls[0].options.onEnd(); assert.equal(p.errors.length, 0);
});

it('muting before playback releases the reply and cancels pending audio', async () => {
  const p = page(); const ready = p.output.speak('Held reply', 'en');
  p.output.setMuted(true);
  assert.equal(await ready, 'muted'); assert.equal(p.calls[0].cancelled, true);
  p.calls[0].options.onStart(); // Cancelled audio must not change readiness.
  assert.equal(await p.output.speak('Immediately visible muted reply', 'en'), 'muted');
  assert.equal(p.calls.length, 1);
});

it('failed or cancelled audio never reports that playback started', async () => {
  const p = page(); const first = p.output.speak('Failure', 'en');
  p.calls[0].options.onError(new Error('Unavailable'));
  assert.equal(await first, 'failed'); assert.equal(p.errors.length, 1);
  const second = p.output.speak('Cancelled', 'en'); p.output.cancel();
  p.calls[1].options.onStart(); assert.equal(await second, 'cancelled');
  const third = p.output.speak('Silent', 'en'); p.calls[2].options.onEnd();
  assert.equal(await third, 'failed'); assert.equal(p.errors.length, 2);
});

it('automatically speaks a fresh reply and replaces earlier playback', () => {
  const p = page(); p.output.prepare(); p.output.speak('First reply','en'); p.output.speak('Second reply','en');
  assert.equal(p.prepared,1); assert.deepEqual(p.calls.map(call=>call.options.text),['First reply','Second reply']);
  assert.equal(p.calls[0].cancelled,true); p.output.dispose(); assert.equal(p.calls[1].cancelled,true);
});

it('remembered mute prevents preparing audio and issuing any speech request', () => {
  const p = page(new Map([['pantry.scoop.muted','true']]));
  p.output.prepare(); p.output.speak('Reply after typing','en'); p.output.speak('Reply after dictation','en');
  assert.equal(p.output.muted,true); assert.equal(p.prepared,0); assert.equal(p.calls.length,0);
});

it('mute cancels a running request, suppresses replies arriving later and survives a new page', () => {
  const p = page(); p.output.speak('Playing','en'); p.output.setMuted(true);
  p.output.speak('Reply that arrived after muting','en');
  assert.equal(p.calls[0].cancelled,true); assert.equal(p.calls.length,1); assert.equal(p.released,1);
  assert.equal(p.values.get('pantry.scoop.muted'),'true');
  const nextPage = page(p.values); assert.equal(nextPage.output.muted,true); nextPage.output.speak('Another reply','en'); assert.equal(nextPage.calls.length,0);
});

it('unmuting prepares audio but does not replay old replies or make a speech request', () => {
  const p = page(new Map([['pantry.scoop.muted','true']])); p.output.speak('Skipped','en'); p.output.setMuted(false);
  assert.equal(p.prepared,1); assert.equal(p.calls.length,0); assert.equal(p.values.get('pantry.scoop.muted'),'false');
  p.output.speak('Next reply','en'); assert.equal(p.calls.length,1);
});

it('hiding or disposing a chat prevents late replies and late errors from starting speech', () => {
  for (const action of ['hide','dispose']) {
    const p = page(); p.output.speak('Playing','en');
    if(action==='hide') { p.hide(); p.output.release(); } else p.output.dispose();
    p.calls[0].options.onError(new Error('late network error')); p.output.speak('Late reply','en');
    assert.equal(p.calls[0].cancelled,true); assert.equal(p.calls.length,1); assert.equal(p.errors.length,0);
  }
});

it('a session remembers mute even when browser storage is unavailable', () => {
  const p = page(); p.options.env.localStorage = {getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  p.output.setMuted(true);
  const reopened = createAutomaticVoice(p.voice,p.options); reopened.speak('Another reply','en');
  assert.equal(reopened.muted,true); assert.equal(p.calls.length,0);
});
