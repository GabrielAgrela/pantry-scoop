import { DailyLimitError } from '../domain/errors.ts';
import type { AiUsageRepository } from '../ports/ai-usage-repository.ts';

export interface AiUsage {
  readonly used: number;
  /** 0 = unlimited. */
  readonly limit: number;
  /** When the count starts again (next UTC midnight). */
  readonly resetsAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Caps each person's AI requests (scans, recipe batches, sorting) per UTC day. */
export class DailyAiLimit {
  private readonly usage: AiUsageRepository;
  private readonly limit: number;
  private readonly now: () => number;

  constructor(usage: AiUsageRepository, limit: number, now: () => number = Date.now) {
    this.usage = usage;
    this.limit = limit;
    this.now = now;
  }

  view(userId: number): AiUsage {
    const now = this.now();
    return {
      used: this.usage.used(userId, dayOf(now)),
      limit: this.limit,
      resetsAt: new Date((Math.floor(now / DAY_MS) + 1) * DAY_MS).toISOString(),
    };
  }

  /** Takes one request from today's allowance; returns how to give it back. */
  consume(userId: number): () => void {
    if (this.limit === 0) return () => {};
    const day = dayOf(this.now());
    if (!this.usage.tryConsume(userId, day, this.limit)) {
      throw new DailyLimitError(`You’ve used all ${this.limit} AI requests for today. More tomorrow!`);
    }
    return () => this.usage.refund(userId, day);
  }
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
