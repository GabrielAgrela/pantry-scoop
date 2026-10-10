import { speechChunks } from '/js/voice.js';

/** Adapter for Android's speech services, independent of the Android WebView's Web Speech support. */
export function createNativeVoice(plugin) {
  return {
    capabilities: () => plugin.capabilities(),
    listen(callbacks) {
      let active = true, listener;
      const finish = () => { if (active) { active = false; listener?.remove(); callbacks.onEnd(); } };
      const ready = (async () => {
        listener = await plugin.addListener('recognition', event => {
          if (!active) return;
          if (event.type === 'start') callbacks.onStart();
          if (event.type === 'result') callbacks.onResult(event.text);
          if (event.type === 'error') callbacks.onError(new Error(event.message));
          if (event.type === 'end') finish();
        });
        if (!active) { await listener.remove(); return; }
        await plugin.startListening({ lang: callbacks.lang });
      })().catch(error => { if (active) { callbacks.onError(error); finish(); } });
      return {
        stop() { ready.then(() => { if (active) plugin.stopListening().catch(error => { if (active) { callbacks.onError(error); finish(); } }); }); },
        cancel() { active = false; listener?.remove(); plugin.cancelListening().catch(() => {}); },
      };
    },
    speak({ text, lang, onEnd, onError }) {
      let active = true;
      (async () => {
        for (const chunk of speechChunks(text)) {
          if (!active) return;
          await plugin.speak({ text: chunk, lang });
        }
        if (active) { active = false; onEnd(); }
      })().catch(error => {
        if (active) { active = false; onError(error); onEnd(); }
      });
      return { cancel() { active = false; plugin.stopSpeaking().catch(() => {}); } };
    },
  };
}
