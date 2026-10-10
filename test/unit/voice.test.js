import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createBrowserVoice, rankVoices, speechChunks, spokenText } from '../../public/js/voice.js';

function speechPage() {
  let recognition;
  const spoken = [];
  let cancelled = 0;
  class Recognition {
    constructor() { recognition = this; }
    start() { this.onstart(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  const env = { isSecureContext: true, webkitSpeechRecognition: Recognition,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => [{ lang: 'en-GB', localService: true }],
      cancel: () => cancelled++, speak: utterance => spoken.push(utterance) } };
  return { env, voice: createBrowserVoice(env), spoken, get recognition() { return recognition; }, get cancelled() { return cancelled; } };
}

it('revises interim dictation rather than duplicating it, and ignores callbacks after cancellation', () => {
  const page = speechPage(), texts = [], errors = [];
  let ended = 0;
  const session = page.voice.listen({ lang: 'en', onStart() {}, onResult: text => texts.push(text), onError: error => errors.push(error), onEnd: () => ended++ });
  page.recognition.onresult({ results: [[{ transcript: 'Can I swap' }]] });
  page.recognition.onresult({ results: [[{ transcript: 'Can I swap the cream?' }]] });
  assert.deepEqual(texts, ['Can I swap', 'Can I swap the cream?']);
  session.stop(); assert.equal(page.recognition.stopped, true);
  session.cancel(); assert.equal(page.recognition.aborted, true);
  page.recognition.onresult({ results: [[{ transcript: 'late result' }]] });
  page.recognition.onerror({ error: 'network' }); page.recognition.onend();
  assert.equal(texts.length, 2); assert.equal(errors.length, 0); assert.equal(ended, 0);
});

it('reports denied microphone access and ends cleanly so typing remains available', () => {
  const page = speechPage(), errors = [];
  let ended = false;
  page.voice.listen({ lang: 'en', onStart() {}, onResult() {}, onError: error => errors.push(error.message), onEnd: () => ended = true });
  page.recognition.onerror({ error: 'not-allowed' }); page.recognition.onend();
  assert.match(errors[0], /denied/); assert.equal(ended, true);
});

it('reads long replies in order with a local matching voice and cancels remaining chunks', () => {
  const page = speechPage(); let ended = 0;
  const session = page.voice.speak({ text: 'Cream can be replaced with oat cream. '.repeat(25), lang: 'en', onError: error => { throw error; }, onEnd: () => ended++ });
  assert.equal(page.spoken.length, 1); assert.equal(page.spoken[0].voice.localService, true);
  page.spoken[0].onend(); assert.equal(page.spoken.length, 2);
  session.cancel(); page.spoken[1].onend();
  assert.equal(page.spoken.length, 2); assert.equal(ended, 0); assert.equal(page.cancelled, 2);
});

it('keeps every word of long and unbroken replies within the engine chunk limit', () => {
  for (const text of ['Use 200 ml cream. '.repeat(400).trim(), 'x'.repeat(6000)]) {
    const chunks = speechChunks(text);
    assert.ok(chunks.every(chunk => chunk.length <= 280));
    assert.equal(chunks.join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
});

it('reports capability differences without starting a microphone or speech service', async () => {
  assert.deepEqual(await createBrowserVoice({}).capabilities(), { listening: false, speaking: false });
  const page = speechPage(); page.env.isSecureContext = false;
  assert.deepEqual(await page.voice.capabilities(), { listening: false, speaking: true });
  assert.equal(page.recognition, undefined); assert.equal(page.spoken.length, 0);
});

it('sends only final recognized speech to the end callback, once', () => {
  const page = speechPage(), ended = [];
  page.voice.listen({ lang:'en', onStart() {}, onResult() {}, onError() {}, onEnd: result => ended.push(result) });
  const partial = [{transcript:'Can I swap'}]; partial.isFinal = false;
  page.recognition.onresult({results:[partial]});
  const final = [{transcript:'Can I swap cream?'}]; final.isFinal = true;
  page.recognition.onresult({results:[final]});
  page.recognition.onend(); page.recognition.onend();
  assert.deepEqual(ended, [{transcript:'Can I swap cream?',failed:false}]);
});

it('does not treat an interim result or a recognition error as sendable speech', () => {
  for (const error of [false, true]) {
    const page = speechPage(); let ended;
    page.voice.listen({ lang:'en', onStart() {}, onResult() {}, onError() {}, onEnd: result => ended = result });
    const words = [{transcript:'partial question'}]; words.isFinal = error;
    page.recognition.onresult({results:[words]});
    if (error) page.recognition.onerror({error:'network'});
    page.recognition.onend();
    assert.ok(!ended.transcript || ended.failed);
  }
});

it('prefers language-matching natural voices over a basic local default', () => {
  const basic = {name:'eSpeak English',lang:'en-US',localService:true,default:true};
  const natural = {name:'Microsoft Jenny Natural',lang:'en-US',localService:false};
  const google = {name:'Google UK English Female',lang:'en-GB',localService:false};
  const french = {name:'French Neural',lang:'fr-FR',localService:false};
  assert.deepEqual(rankVoices([basic,french,google,natural], 'en'), [natural,google,basic]);
});

it('honours a manually selected voice even when preference storage is unavailable', () => {
  const page = speechPage();
  const natural = {name:'Natural',voiceURI:'natural',lang:'en-US',localService:false};
  const custom = {name:'My voice',voiceURI:'custom',lang:'en-GB',localService:true};
  page.env.speechSynthesis.getVoices = () => [natural,custom];
  page.voice.setPreferredVoice('custom');
  page.voice.speak({text:'Hello',lang:'en',onError() {},onEnd() {}});
  assert.equal(page.spoken[0].voice, custom);
  assert.equal(page.spoken[0].rate, 1);
});

it('uses voices loaded after initialization and speaks text without markdown markers', () => {
  const page = speechPage();
  page.env.speechSynthesis.getVoices = () => [];
  assert.deepEqual(page.voice.voices('en'), []);
  const google = {name:'Google US English',voiceURI:'google',lang:'en-US',localService:false};
  page.env.speechSynthesis.getVoices = () => [google];
  page.voice.speak({text:'**Use cream.**\n- [Chill it](https://example.com).',lang:'en',onError() {},onEnd() {}});
  assert.equal(page.spoken[0].voice, google);
  assert.equal(spokenText('**Use cream.**\n- [Chill it](https://example.com).'), 'Use cream. Chill it.');
});
