import { t } from './i18n.js';

const MUTE_SETTING = 'pantry.scoop.muted';
const preferences = new WeakMap();

/** One saved mute choice for this browser; only fresh visible replies may start speech. */
export function createAutomaticVoice(voice, { env = globalThis, allowed = () => true, onError = () => {}, onChange = () => {} } = {}) {
  let preference = preferences.get(env);
  if (!preference) {
    let muted = false;
    try { muted = env.localStorage?.getItem(MUTE_SETTING) === 'true'; } catch { /* retain the session choice */ }
    preference = { muted, listeners: new Set() };
    preferences.set(env, preference);
  }
  let playback, readiness, sequence = 0, disposed = false;
  const settle = result => { readiness?.(result); readiness = undefined; };
  const cancel = (reason = 'cancelled') => { settle(reason); sequence++; playback?.cancel(); playback = undefined; };
  const prepare = () => {
    if (disposed || preference.muted || !allowed()) return;
    const current = sequence;
    try { Promise.resolve(voice.prepare?.()).catch(error => { if (current === sequence && !disposed && !preference.muted && allowed()) onError(error); }); }
    catch (error) { onError(error); }
  };
  const changed = () => {
    if (preference.muted) { cancel('muted'); voice.release?.(); }
    onChange(preference.muted);
  };
  preference.listeners.add(changed);
  return {
    get muted() { return preference.muted; },
    prepare,
    setMuted(muted) {
      if (disposed) return;
      preference.muted = !!muted;
      try { env.localStorage?.setItem(MUTE_SETTING, String(preference.muted)); } catch { /* session preference still applies */ }
      preference.listeners.forEach(listener => listener());
      if (!preference.muted) prepare();
    },
    speak(text, lang) {
      cancel();
      if (disposed || !allowed()) return Promise.resolve('cancelled');
      if (preference.muted) return Promise.resolve('muted');
      const current = sequence;
      const ready = new Promise(resolve => { readiness = resolve; });
      try {
        playback = voice.speak({ text, lang,
          onStart: () => { if (current === sequence && !disposed && !preference.muted && allowed()) settle('started'); },
          onEnd: () => {
            if (current !== sequence) return;
            playback = undefined;
            if (readiness) { settle('failed'); onError(new Error(t('Scoop’s voice finished without starting playback.'))); }
          },
          onError: error => {
            if (current === sequence && !disposed && !preference.muted && allowed()) { settle('failed'); onError(error); }
          },
        });
      } catch (error) { settle('failed'); onError(error); }
      return ready;
    },
    cancel,
    release() { cancel(); voice.release?.(); },
    dispose() { disposed = true; cancel(); voice.release?.(); preference.listeners.delete(changed); },
  };
}
