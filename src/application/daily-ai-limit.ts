import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Caps each person's AI requests per UTC day. One request is one thing they ask for (a scan, a recipe
 * batch, a sort, a chat question...), however many model calls it takes; see AiAllowance.
 */
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

/** One thing the person asked for; `refund` is set once it has taken its unit. */
interface Action {
  readonly userId: number;
  refund?: () => void;
}

const currentAction = new AsyncLocalStorage<Action>();

/** An action whose unit was taken up front; run its work once, or cancel it if the work never starts. */
export interface ReservedAction {
  run<T>(work: () => Promise<T>): Promise<T>;
  cancel(): void;
}

/**
 * One person's allowance, spent per action rather than per model call. The first AI call of an
 * action takes one unit, refusing before the call when none is left; the calls the app makes on its
 * own inside that action (an equipment review, a translation) ride on it. An action that fails gives
 * its unit back. An AI call made outside any action counts as an action of its own.
 */
export class AiAllowance {
  private readonly limit: DailyAiLimit;
  private readonly userId: number;

  constructor(limit: DailyAiLimit, userId: number) {
    this.limit = limit;
    this.userId = userId;
  }

  /**
   * Runs one thing the person asked for. `delivered` can tell a result that carries nothing apart
   * from a real one, so an action that failed without throwing is given back too.
   */
  act<T>(work: () => Promise<T>, delivered: (result: T) => boolean = () => true): Promise<T> {
    return this.inAction() ? work() : this.run({ userId: this.userId }, work, delivered);
  }

  /** Takes the unit now, so background work is refused when it is submitted rather than when it runs. */
  reserve(): ReservedAction {
    const action: Action = { userId: this.userId, refund: this.limit.consume(this.userId) };
    return { run: (work) => this.run(action, work, () => true), cancel: () => giveBack(action) };
  }

  /** Every AI call goes through here, charging the action it belongs to (once). */
  call<T>(work: () => Promise<T>): Promise<T> {
    return this.act(async () => {
      const action = currentAction.getStore()!;
      action.refund ??= this.limit.consume(this.userId);
      return work();
    });
  }

  private inAction(): boolean {
    return currentAction.getStore()?.userId === this.userId;
  }

  private async run<T>(action: Action, work: () => Promise<T>, delivered: (result: T) => boolean): Promise<T> {
    let result: T;
    try {
      result = await currentAction.run(action, work);
    } catch (error) {
      giveBack(action);
      throw error;
    }
    if (!delivered(result)) giveBack(action);
    return result;
  }
}

function giveBack(action: Action): void {
  const refund = action.refund;
  action.refund = undefined;
  refund?.();
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
