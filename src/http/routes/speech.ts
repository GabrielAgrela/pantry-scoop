import { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import { AiUnavailableError, ValidationError } from '../../domain/errors.ts';
import type { SpeechSynthesizer } from '../../ports/speech-synthesizer.ts';
import { bodyObject } from '../params.ts';
import { LANGUAGE_HEADER, languageCode, speechVoice } from '../../domain/language.ts';

export function speechRoutes(speech?: SpeechSynthesizer): FastifyPluginAsync {
  return async app => {
    app.get('/capabilities', async request => ({ speaking: !!speech, voice: speechVoice(languageCode(request.headers[LANGUAGE_HEADER])) }));
    app.post('/', {
      bodyLimit: 32 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: request => String(request.userId) } },
    }, async (request, reply) => {
      const { text } = bodyObject(request.body);
      if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new ValidationError('Speech must contain 1–6000 characters.');
      if (!speech) throw new AiUnavailableError('Scoop’s voice needs an OpenRouter API key. Please contact the app owner.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('Speech timed out.')), 90_000);
      const cancel = () => controller.abort();
      const cleanup = () => { clearTimeout(timeout); reply.raw.off('close', cancel); };
      reply.raw.once('close', cancel);
      try {
        const audio = await speech.synthesize(text.trim(), controller.signal, speechVoice(languageCode(request.headers[LANGUAGE_HEADER])));
        const stream = Readable.fromWeb(audio as import('node:stream/web').ReadableStream<Uint8Array>);
        controller.signal.addEventListener('abort', () => stream.destroy(new Error('Speech cancelled.')), { once: true });
        stream.once('close', () => { controller.abort(); cleanup(); });
        if (controller.signal.aborted) stream.destroy(new Error('Speech cancelled.'));
        reply.header('Content-Type', 'audio/pcm; rate=24000; channels=1');
        reply.header('X-Accel-Buffering', 'no');
        return reply.send(stream);
      } catch (error) { controller.abort(); cleanup(); throw error; }
    });
  };
}
