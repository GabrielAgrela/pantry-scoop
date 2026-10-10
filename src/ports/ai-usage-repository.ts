/** How many AI requests (actions, not model calls) each person made per day (`day` = YYYY-MM-DD, UTC). */
export interface AiUsageRepository {
  used(userId: number, day: string): number;
  /** Counts one request unless `limit` is already reached; false = refused. */
  tryConsume(userId: number, day: string, limit: number): boolean;
  /** Gives back a request that failed or delivered nothing. */
  refund(userId: number, day: string): void;
}
