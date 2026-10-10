import type { DatabaseSync } from 'node:sqlite';
import type { Job, JobError, JobKind, JobStatus } from '../../domain/job.ts';
import type { JobRepository } from '../../ports/job-repository.ts';

interface Row {
  id: number;
  kind: string;
  status: string;
  request: string;
  result: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const KEEP_PER_USER = 30;

function toJob(row: Row): Job {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    request: JSON.parse(row.request),
    result: row.result === null ? null : JSON.parse(row.result),
    error: row.error === null ? null : (JSON.parse(row.error) as JobError),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export class SqliteJobRepository implements JobRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  /** A job can't outlive the process that ran it: mark leftovers from a previous run failed. */
  static failInterrupted(db: DatabaseSync, now: Date = new Date()): void {
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'`).run(
      JSON.stringify({ message: 'Interrupted by a restart. Try again.', code: 'ai-unavailable' }),
      now.toISOString(),
    );
  }

  create(kind: JobKind, request: unknown): Job {
    const row = this.db
      .prepare(
        `INSERT INTO jobs (user_id, kind, status, request, created_at) VALUES (?, ?, 'running', ?, ?) RETURNING *`,
      )
      .get(this.userId, kind, JSON.stringify(request ?? null), this.now().toISOString());
    this.db
      .prepare(
        `DELETE FROM jobs WHERE user_id = ? AND status != 'running'
         AND NOT (kind = 'recipes' AND status = 'succeeded')
         AND id NOT IN (SELECT id FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(this.userId, this.userId, KEEP_PER_USER);
    return toJob(row as unknown as Row);
  }

  succeed(id: number, result: unknown): void {
    this.finish(id, 'succeeded', JSON.stringify(result ?? null), null);
  }

  fail(id: number, error: JobError): void {
    this.finish(id, 'failed', null, JSON.stringify(error));
  }

  rewriteResult(id: number, result: unknown): void {
    this.db.prepare("UPDATE jobs SET result = ? WHERE id = ? AND user_id = ? AND status = 'succeeded'").run(JSON.stringify(result ?? null), id, this.userId);
  }

  find(id: number): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, this.userId);
    return row ? toJob(row as unknown as Row) : undefined;
  }

  recent(kind: JobKind | undefined, limit: number): Job[] {
    const rows = kind
      ? this.db.prepare('SELECT * FROM jobs WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?').all(this.userId, kind, limit)
      : this.db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(this.userId, limit);
    return (rows as unknown as Row[]).map(toJob);
  }

  countRunning(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status = 'running'`).get(this.userId) as { n: number }).n;
  }

  recipeHistory(limit: number, beforeId?: number): Job[] {
    const rows = this.db.prepare(
      `SELECT * FROM jobs WHERE user_id = ? AND kind = 'recipes' AND status = 'succeeded'
       AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    ).all(this.userId, beforeId ?? null, beforeId ?? null, limit);
    return (rows as unknown as Row[]).map(toJob);
  }

  clearRecipeHistory(): number {
    const result = this.db.prepare(`DELETE FROM jobs WHERE user_id = ? AND kind = 'recipes' AND status != 'running'`).run(this.userId);
    return Number(result.changes);
  }

  private finish(id: number, status: JobStatus, result: string | null, error: string | null): void {
    this.db
      .prepare('UPDATE jobs SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ? AND user_id = ?')
      .run(status, result, error, this.now().toISOString(), id, this.userId);
  }
}
