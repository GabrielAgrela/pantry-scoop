# Natural speech sections and reply timing

2026-10-07, web only.

The old server split at 90/160 character limits, sometimes after a conjunction. The client also waited for the last queued buffer at its two-second high-water mark, draining the queue before refilling it and adding a new 60 ms lead-in.

The server now segments complete sentences with Intl.Segmenter. It groups them toward soft 160/240 character targets, leaving a sentence longer than the target intact. Only sentences longer than 280 characters may split at a marked clause (semicolon, colon, spaced dash, or a comma before an explicit clause conjunction). Ingredient lists and measurements remain intact. One generation is still prefetched, with cancellation propagated to both requests.

The player waits for the oldest buffer when backpressure applies, refilling while later audio is queued. The 60 ms lead-in applies only to the opening buffer. Pitch remains four semitones higher. Playback-start notification follows the audio clock at the first sample above 0.2% amplitude, so leading silence does not reveal the reply prematurely.

The chat keeps its pending indicator until this playback-start notification. Muted or unavailable speech reveals text immediately without requesting TTS. Muting during preparation reveals the held reply and aborts pending audio. Speech errors keep text held, with an explicit prompt to mute to read it. Capability checks finish before choosing speech or immediate display. Close/background cancellation cannot trigger a late playback-start notification.

Verification:

- 28 focused tests passed: complete thoughts, measurements/abbreviations, long clauses, bounded prefetch, cancellation, PCM odd-byte handling, audio-clock readiness, silent prefixes, queue refill while audio remains, pitch scheduling, saved mute and error states.
- Full check: typecheck plus 339 tests passed. Frontend syntax and diff whitespace checks passed.
- Real OpenRouter/Kokoro request for a 335-character reply: two complete-thought sections of 158 and 176 characters; first PCM at 1.065 seconds, all PCM at 2.289 seconds, 961,200 bytes / 20.025 seconds of source audio. These are server delivery measurements, not a claim of browser-audible QA or a guaranteed provider latency.
- Built-in Browser verification is blocked: attached this exact host task with the configured XAUTHORITY, restored Browser documentation, confirmed the local QA server at port 3229, and attempted fresh built-in tabs twice. Both timed out waiting for the Browser webview. No substitute browser was used.

Deployment: the watcher completed its checks and published a healthy container. Live recipe-chat, automatic-voice and kokoro-voice module hashes match the workspace; the running container’s server adapter hash also matches.
