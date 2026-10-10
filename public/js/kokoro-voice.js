import { t } from './i18n.js';

// Four semitones up gives Heart a small, bright mascot character. Resampling
// also makes delivery 26% quicker; apply one rate across the entire stream.
const SCOOP_PLAYBACK_RATE = 2 ** (4 / 12);

/** PCM playback starts before the response finishes; no Blob or whole-file decoding. */
export function createKokoroVoice(listeningVoice, env = globalThis, request = (url, options) => env.fetch(url, options)) {
  const AudioContext = env.AudioContext || env.webkitAudioContext;
  let preparedContext, preparation;
  const prepare = () => {
    if (!AudioContext) return Promise.resolve();
    if (!preparedContext || preparedContext.state === 'closed') preparedContext = new AudioContext();
    const context = preparedContext;
    preparation = context.resume().then(() => {
      if (context.state === 'suspended') throw new Error(t('Tap Send or Talk to Scoop to enable audio.'));
    });
    // prepare may run during a gesture before the reply arrives.
    preparation.catch(() => {});
    return preparation;
  };
  return {
    listen: options => listeningVoice.listen(options),
    fixedVoice: 'Heart',
    prepare,
    release() {
      preparedContext?.close().catch(() => {});
      preparedContext = preparation = undefined;
    },
    async capabilities() {
      const listening = (await listeningVoice.capabilities()).listening;
      const response = await request('/api/speech/capabilities');
      if (!response.ok) throw new Error(t('Could not check Scoop’s voice. Please try again.'));
      return { listening, speaking: !!AudioContext && !!env.ReadableStream && (await response.json()).speaking };
    },
    speak({ text, onStart = () => {}, onEnd, onError }) {
      const controller = new env.AbortController();
      let active = true, context, reader, tail = new Uint8Array(), nextTime = 0, received = false, lastEnded;
      let startTime, startTimer, started = false;
      const sources = new Map();
      const setTimer = (callback, delay) => (env.setTimeout || globalThis.setTimeout)(callback, delay);
      const clearTimer = timer => (env.clearTimeout || globalThis.clearTimeout)(timer);
      const announceStart = () => {
        if (!active || started || startTime === undefined) return;
        if (context.state !== 'suspended' && context.currentTime >= startTime) {
          started = true; clearTimer(startTimer); onStart();
        } else {
          clearTimer(startTimer);
          startTimer = setTimer(announceStart, Math.max(10, (startTime - context.currentTime) * 1000));
        }
      };
      const dispose = () => {
        clearTimer(startTimer);
        controller.abort();
        reader?.cancel().catch(() => {});
        for (const source of sources.keys()) { try { source.stop(); } catch { /* already ended */ } }
        sources.clear();
        context?.close().catch(() => {});
      };
      // Use the context unlocked by Send/microphone before waiting for the reply.
      let ready;
      try {
        if (!AudioContext) throw new Error(t('Audio playback is unavailable in this browser.'));
        if (!preparedContext) prepare();
        context = preparedContext; ready = preparation;
        preparedContext = preparation = undefined;
      }
      catch (error) { ready = Promise.reject(error); }
      const run = async () => {
        await ready;
        if (!active) return;
        const response = await request('/api/speech', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
        });
        if (!active) { await response.body?.cancel(); return; }
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(failure.error ? t(failure.error) : t('Scoop could not read this aloud. Please try again.'));
        }
        if (!/^audio\/pcm(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '') || !response.body) throw new Error(t('Scoop’s voice returned unsupported audio.'));
        reader = response.body.getReader();
        while (active) {
          const { value, done } = await reader.read();
          if (!active) return;
          if (done) break;
          const bytes = new Uint8Array(tail.length + value.length);
          bytes.set(tail); bytes.set(value, tail.length);
          const length = bytes.length - bytes.length % 2;
          tail = bytes.slice(length);
          const view = new DataView(bytes.buffer, bytes.byteOffset, length);
          for (let offset = 0; offset < length && active; offset += 24000) {
            // Bound queued playback; stream reading pauses while queued audio plays.
            // Refill when the oldest buffer ends, while the rest are still playing.
            while (nextTime - context.currentTime > 2 && sources.size) await sources.values().next().value;
            if (!active) return;
            const samples = Math.min(24000, length - offset) / 2;
            const buffer = context.createBuffer(1, samples, 24000);
            const channel = buffer.getChannelData(0);
            let firstAudible = -1;
            for (let i = 0; i < samples; i++) {
              channel[i] = view.getInt16(offset + i * 2, true) / 32768;
              if (firstAudible < 0 && Math.abs(channel[i]) > 0.002) firstAudible = i;
            }
            const source = context.createBufferSource();
            source.playbackRate.value = SCOOP_PLAYBACK_RATE;
            source.buffer = buffer; source.connect(context.destination);
            lastEnded = new Promise(resolve => { source.onended = () => { sources.delete(source); announceStart(); resolve(); }; });
            sources.set(source, lastEnded);
            nextTime = Math.max(nextTime, context.currentTime + (received ? 0 : 0.06));
            if (startTime === undefined && firstAudible >= 0) startTime = nextTime + firstAudible / (24000 * SCOOP_PLAYBACK_RATE);
            source.start(nextTime); nextTime += buffer.duration / SCOOP_PLAYBACK_RATE;
            received = true;
            if (!started && startTime !== undefined) announceStart();
          }
        }
        if (!active) return;
        if (tail.length || !received) throw new Error(t('Scoop’s audio was incomplete. Please try again.'));
        await lastEnded;
        if (active) { active = false; dispose(); onEnd(); }
      };
      run().catch(error => {
        if (!active) return;
        active = false; dispose();
        onError(error.name === 'NotAllowedError' ? new Error(t('Tap Send or Talk to Scoop to enable audio.')) : error);
        onEnd();
      });
      return { cancel() { if (active) { active = false; dispose(); } } };
    },
  };
}
