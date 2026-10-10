import { AiUnavailableError } from '../../domain/errors.ts';
import type { SpeechSynthesizer } from '../../ports/speech-synthesizer.ts';

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Keep complete thoughts together. Sizes are grouping targets, never word cuts. */
export function speechSegments(text: string): string[] {
  const thoughts: string[] = [];
  for (const { segment } of sentences.segment(text.replace(/\s+/g, ' ').trim())) {
    const sentence = segment.trim();
    let start = 0;
    // Long sentences may pause at a marked clause, never in an ingredient list
    // or between a conjunction and the rest of its thought.
    if (sentence.length > 280) {
      const clauses = /[;:]\s+|\s+[—–]\s+|,\s+(?=(?:but|however|so|because|although|while|whereas|then)\b)/gi;
      for (const boundary of sentence.matchAll(clauses)) {
        const end = boundary.index! + boundary[0].trimEnd().length;
        if (end - start < 60 || sentence.length - end < 40) continue;
        thoughts.push(sentence.slice(start, end).trim()); start = boundary.index! + boundary[0].length;
      }
    }
    thoughts.push(sentence.slice(start).trim());
  }
  const segments: string[] = [];
  let current = '';
  for (const thought of thoughts.filter(Boolean)) {
    const target = segments.length ? 240 : 160;
    if (current.length >= 48 && current.length + thought.length + 1 > target) {
      segments.push(current); current = '';
    }
    current += (current ? ' ' : '') + thought;
  }
  if (current) segments.push(current);
  return segments;
}

export class KokoroSpeech implements SpeechSynthesizer {
  private readonly apiKey: string;
  private readonly request: typeof fetch;
  constructor(apiKey: string, request: typeof fetch = fetch) { this.apiKey = apiKey; this.request = request; }

  async synthesize(text: string, signal: AbortSignal, voice = 'af_heart'): Promise<ReadableStream<Uint8Array>> {
    if (signal.aborted) throw signal.reason;
    const segments = speechSegments(text);
    if (!segments.length) throw new AiUnavailableError('Scoop’s voice needs some text.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      controller.abort(); signal.removeEventListener('abort', abort);
      next?.then(audio => audio.cancel().catch(() => {})).catch(() => {});
    };
    const open = (index: number) => {
      const pending = this.requestAudio(segments[index]!, voice, controller.signal);
      pending.catch(() => {}); // Prefetched failures are reported when that section is reached.
      return pending;
    };
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    let nextIndex = 1, bytes = 0, disposed = false;
    const first = open(0);
    let next = segments.length > 1 ? open(1) : undefined;
    try { reader = (await first).getReader(); }
    catch (error) { cleanup(); throw error; }
    return new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          while (!disposed) {
            const chunk = await reader.read();
            if (disposed) return;
            if (!chunk.done) { bytes += chunk.value.length; output.enqueue(chunk.value); return; }
            reader.releaseLock();
            if (!bytes || bytes % 2) throw new AiUnavailableError('Scoop’s audio was incomplete. Please try again.');
            if (!next) { disposed = true; output.close(); cleanup(); return; }
            const audio = await next;
            next = undefined;
            if (disposed) { await audio.cancel(); return; }
            reader = audio.getReader(); bytes = 0; nextIndex++;
            next = nextIndex < segments.length ? open(nextIndex) : undefined;
          }
        } catch (error) {
          if (!disposed) { disposed = true; output.error(error); }
          cleanup();
        }
      },
      async cancel() {
        disposed = true; cleanup();
        await reader.cancel().catch(() => {});
      },
    });
  }

  private async requestAudio(text: string, voice: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    let response: Response;
    try {
      response = await this.request('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'hexgrad/kokoro-82m', voice, input: text, response_format: 'pcm',
          provider: { options: { deepinfra: { extra_body: { stream: true, sample_rate: 24000 } } } },
        }),
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new AiUnavailableError('Scoop’s voice could not connect. Please try again.');
    }
    if (signal.aborted) { await response.body?.cancel(); throw signal.reason; }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiUnavailableError(response.status === 402
        ? 'Scoop’s voice needs OpenRouter credits. Please contact the app owner.'
        : 'Scoop’s voice is temporarily unavailable. Please try again.');
    }
    const type = response.headers.get('content-type') || '';
    const rate = type.match(/\brate=(\d+)/i)?.[1];
    const channels = type.match(/\bchannels=(\d+)/i)?.[1];
    if (!/^audio\/pcm(?:\s*;|$)/i.test(type) || (rate && rate !== '24000') || (channels && channels !== '1') || !response.body) {
      await response.body?.cancel();
      throw new AiUnavailableError('Scoop’s voice returned an unsupported audio format.');
    }
    return response.body;
  }
}
