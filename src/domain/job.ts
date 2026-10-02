/** Long-running AI work (photo scan, recipe ideas) that survives page reloads. */
export type JobKind = 'scan' | 'recipes';
export type JobStatus = 'running' | 'succeeded' | 'failed';

export interface JobError {
  readonly message: string;
  /** DomainError kind, e.g. "usage-limit", so the UI can offer the right action. */
  readonly code: string;
}

export interface Job {
  readonly id: number;
  readonly kind: JobKind;
  readonly status: JobStatus;
  /** What was asked (validated options; never photos). */
  readonly request: unknown;
  readonly result: unknown;
  readonly error: JobError | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export const JOB_KINDS: readonly JobKind[] = ['scan', 'recipes'];
