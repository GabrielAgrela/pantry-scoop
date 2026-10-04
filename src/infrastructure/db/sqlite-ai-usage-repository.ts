import type { DatabaseSync } from 'node:sqlite';
import type { AiUsageRepository } from '../../ports/ai-usage-repository.ts';

export class SqliteAiUsageRepository implements AiUsageRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  used(userId: number, day: string): number {
    const row = this.db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** One statement, so parallel requests can't both take the last slot. */
  tryConsume(userId: number, day: string, limit: number): boolean {
    const { changes } = this.db
      .prepare(
        `INSERT INTO ai_usage (user_id, day, count) SELECT ?, ?, 1 WHERE ? > 0
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?`,
      )
      .run(userId, day, limit, limit);
    return Number(changes) > 0;
  }

  refund(userId: number, day: string): void {
    this.db.prepare('UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0').run(userId, day);
  }
}
