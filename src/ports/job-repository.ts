import type { Job, JobError, JobKind } from '../domain/job.ts';

/** One user's jobs. */
export interface JobRepository {
  create(kind: JobKind, request: unknown): Job;
  succeed(id: number, result: unknown): void;
  fail(id: number, error: JobError): void;
  find(id: number): Job | undefined;
  /** Newest first. */
  recent(kind: JobKind | undefined, limit: number): Job[];
  countRunning(): number;
}
