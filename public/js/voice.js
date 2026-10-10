import { platform } from './platform.js';
import { createKokoroVoice } from './kokoro-voice.js';
import { LANGUAGE_HEADER, locale, t } from './i18n.js';

/** Short utterances avoid engine input limits and long-utterance stalls. */
export function speechChunks(text, limit = 280) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const section = rest.slice(0, limit);
    const sentence = Math.max(section.lastIndexOf('. '), section.lastIndexOf('? '), section.lastIndexOf('! '));
    const boundary = sentence > limit / 3 ? sentence + 1 : section.lastIndexOf(' ');
    const end = boundary > 0 ? boundary : limit;
    chunks.push(rest.slice(0, end)); rest = rest.slice(end).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function voiceError(code) {
  return new Error({
    'not-allowed': t('Microphone access was denied. Allow it in your browser or app settings, then try again.'),
    'service-not-allowed': t('Speech recognition is not available in this browser.'),
    'audio-capture': t('No microphone was found. Check that it is connected and available.'),
    'no-speech': t('I didn’t hear a question. Tap the microphone and try again.'),
    'network': t('Speech recognition could not connect. Check your connection and try again.'),
    'language-not-supported': t('Speech recognition does not support your selected language.'),
    'unsupported': t('Voice input is not supported on this device.'),
  }[code] || t('Voice input could not start. Please try again.'));
}

const VOICE_SETTING = 'pantry.scoop.voice';
const voiceId = voice => voice.voiceURI || `${voice.name}|${voice.lang}`;

/** Voice names are quality hints, not a guarantee; the picker lets the cook compare them. */
export function rankVoices(voices, lang) {
  const language = lang.toLowerCase().split('-')[0];
  const score = voice => {
    const name = voice.name || '';
    return (/natural|neural|premium|enhanced/i.test(name) ? 100 : 0)
      + (/google|online/i.test(name) ? 40 : 0)
      + (voice.localService === false ? 10 : 0)
      + (voice.lang.toLowerCase() === lang.toLowerCase() ? 5 : 0)
      + (voice.default ? 2 : 0)
      - (/espeak|festival|mbrola/i.test(name) ? 150 : 0);
  };
  return voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === language)
    .sort((a, b) => score(b) - score(a) || (a.name || '').localeCompare(b.name || ''));
}

export function spokenText(text) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(^|\n)\s*(?:#{1,6}\s+|[-*•]\s+)/g, '$1')
    .replace(/\*\*|__|`/g, '').replace(/\n+/g, '. ').replace(/\.\s*\./g, '.').trim();
}

/** Speech stays with the browser/device service; Pantry Scoop receives only the question text. */
export function createBrowserVoice(env = globalThis) {
  const Recognition = env.SpeechRecognition || env.webkitSpeechRecognition;
  const voices = lang => rankVoices(env.speechSynthesis?.getVoices() || [], lang);
  let voicePreference;
  const preferredVoice = () => {
    if (voicePreference !== undefined) return voicePreference;
    try { return env.localStorage?.getItem(VOICE_SETTING) || ''; } catch { return ''; }
  };
  return {
    voices: lang => voices(lang).map(voice => ({ id: voiceId(voice), name: voice.name || t('Device voice'), lang: voice.lang })),
    preferredVoice,
    setPreferredVoice(id) { voicePreference = id; try { env.localStorage?.setItem(VOICE_SETTING, id); } catch { /* keep the choice for this chat */ } },
    onVoicesChanged(callback) {
      env.speechSynthesis?.addEventListener?.('voiceschanged', callback);
      return () => env.speechSynthesis?.removeEventListener?.('voiceschanged', callback);
    },
    async capabilities() {
      return { listening: !!Recognition && env.isSecureContext !== false,
        speaking: !!env.speechSynthesis && !!env.SpeechSynthesisUtterance };
    },
    listen({ lang, onStart, onResult, onEnd, onError }) {
      let active = true, finalTranscript = '', failed = false;
      const recognition = new Recognition();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onstart = () => { if (active) onStart(); };
      recognition.onresult = event => {
        if (!active) return;
        finalTranscript = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ');
        // Results are the complete session, including revisions of interim words.
        onResult(Array.from(event.results, result => result[0].transcript).join(' '));
      };
      recognition.onerror = event => {
        failed = true;
        if (active && event.error !== 'aborted') onError(voiceError(event.error));
      };
      recognition.onend = () => { if (active) { active = false; onEnd({ transcript: finalTranscript, failed }); } };
      try { recognition.start(); }
      catch (error) { active = false; onError(voiceError(error.name === 'NotAllowedError' ? 'not-allowed' : 'unsupported')); onEnd(); }
      return {
        stop() {
          if (!active) return;
          try { recognition.stop(); }
          catch { active = false; onError(voiceError('unsupported')); onEnd(); }
        },
        cancel() { if (active) { active = false; try { recognition.abort(); } catch { /* already stopped */ } } },
      };
    },
    speak({ text, lang, onEnd, onError }) {
      let active = true;
      const synthesis = env.speechSynthesis;
      const chunks = speechChunks(spokenText(text));
      // Read voices at playback time: browsers often load them after the page opens.
      const available = voices(lang);
      const selected = available.find(voice => voiceId(voice) === preferredVoice()) || available[0] || null;
      const next = () => {
        if (!active) return;
        if (!chunks.length) { active = false; onEnd(); return; }
        const utterance = new env.SpeechSynthesisUtterance(chunks.shift());
        utterance.lang = selected?.lang || lang; utterance.rate = 1; utterance.pitch = 1;
        utterance.voice = selected;
        utterance.onend = next;
        utterance.onerror = event => {
          if (!active) return;
          active = false;
          if (!['canceled', 'interrupted'].includes(event.error)) onError(new Error(t('Scoop could not read this aloud. Check your device’s speech settings.')));
          onEnd();
        };
        try { synthesis.speak(utterance); }
        catch { active = false; onError(new Error(t('Read aloud is not available on this device.'))); onEnd(); }
      };
      synthesis.cancel();
      next();
      return { cancel() { active = false; synthesis.cancel(); } };
    },
  };
}

export const recipeVoice = () => {
  if (platform.voice) return platform.voice;
  const voice = createKokoroVoice(createBrowserVoice(), globalThis,
    (url, options) => platform.request(url, { ...options, headers: { ...options?.headers, [LANGUAGE_HEADER]: locale } }));
  return { ...voice, speak: options => voice.speak({ ...options, text: spokenText(options.text) }) };
};
