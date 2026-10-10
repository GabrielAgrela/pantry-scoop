/** Signed 16-bit little-endian, mono PCM at 24 kHz, delivered incrementally. */
export interface SpeechSynthesizer {
  /** `voice` names a voice that can pronounce the text's language; omitted, the default English one. */
  synthesize(text: string, signal: AbortSignal, voice?: string): Promise<ReadableStream<Uint8Array>>;
}
