# Scoop first-audio delay and voice keyboard — 2026-10-07

The phone user reported silence immediately after the text reply appeared, then clarified that they checked shortly afterward. Live logs confirmed an unmuted speech request completed after 19 seconds and another was cancelled after four seconds. Those completion timestamps did not establish first-audio latency.

## Cause and correction

- A direct OpenRouter Kokoro request matching the pictured reply produced its first byte after 28,485 ms, then delivered 20.025 seconds of PCM in about one second. A top-level streaming flag still produced first audio after 28,705 ms. DeepInfra's documented `extra_body` options with smaller token targets still waited 15,483 ms. HTTP chunk counts and PCM response headers alone therefore did not prove incremental generation.
- The opening sentence on its own arrived after 3,162 ms. The server now generates a short opening section (up to 90 characters) and following sections of up to 160 characters, at sentence or word boundaries. One section is prefetched while the current section streams. There are at most two upstream generations active or pending at once, with the same model and Heart voice throughout.
- Corrected DeepInfra passthrough placement to `provider.options.deepinfra.extra_body`, including `stream` and `sample_rate`. The measured improvement comes from short-section generation with prefetch; provider token-by-token streaming is not claimed.
- One browser request receives all PCM sections in order. Browser backpressure propagates to the server; the entire reply is not collected before playback. Cancel/mute aborts active and prefetched requests and cancels unread audio. Partial upstream failures error the stream rather than silently ending a partial reply. Sections are checked for empty or odd-length PCM.
- On the same reply, the revised adapter produced first audio at 2,744 ms while later generations were pending, and completed network delivery in 5,370 ms. A second test through the authenticated real HTTP route produced first audio at 2,887 ms and completed delivery in 11,246 ms, with 961,200 PCM bytes (20.025 seconds), 232 reader chunks and `X-Accel-Buffering: no`. These are network timings; they do not verify the phone's audible output.
- More upstream requests are made for a long reply, but input text is split without repeating words. Character-based billing still applies. Muted replies issue no TTS requests. The cartoon playback effect is unchanged.

## Keyboard behavior and checks

- Starting dictation blurs the question textarea. Voice completion, silence and failed recognition do not focus it again. The automatic voice submission marks its origin synchronously, and its eventual reply/error cleanup preserves that origin, so it does not reopen the keyboard. Typed submission retains its existing focus behavior.
- TypeScript and all 333 tests pass. New tests cover preserved text and decimal measurements, opening audio while the next generation is unresolved, bounded prefetch, full ordered output, cancellation of both generations and a prefetched failure after partial playback. Frontend syntax and diff whitespace checks pass.
- Automatic deployment reported a healthy container. The live server adapter matches the local SHA-256 hash, and public HTTPS recipe-chat.js matches local bytes.
- The exact task was attached to the host desktop. Fresh built-in Browser tabs failed repeatedly while waiting for webview attachment, including after the final fixes against the confirmed QA server on port 3229. Browser playback and the phone's keyboard behavior remain unverified through Browser control. No other browser was substituted; the QA server was stopped afterward.
- Web-only scope; no native source edits or native build in this task.

References: [OpenRouter provider options and short-segment advice](https://openrouter.ai/docs/guides/overview/multimodal/tts), [DeepInfra Kokoro API schemas](https://deepinfra.com/hexgrad/Kokoro-82M/api).
