import { ConflictError, DomainError, NotFoundError } from '../domain/errors.ts';
import type { Job, JobKind } from '../domain/job.ts';
import type { JobRepository } from '../ports/job-repository.ts';
import type { AiAllowance } from './daily-ai-limit.ts';

const MAX_RUNNING_PER_USER = 3;

/**
 * Runs AI work in the background and records the outcome, so a reload, another tab or a
 * dropped connection never loses a scan or a batch of recipe ideas. Each job is one action against the
 * person's daily AI allowance.
 */
export class JobService {
  private readonly jobs: JobRepository;
  private readonly allowance: AiAllowance;
  private readonly onError: (error: unknown) => void;

  constructor(jobs: JobRepository, allowance: AiAllowance, onError: (error: unknown) => void = () => {}) {
    this.jobs = jobs;
    this.allowance = allowance;
    this.onError = onError;
  }

  /**
   * Starts `work` without waiting for it; returns the job immediately. Its AI request is taken now,
   * so a person with none left is told straight away, and given back if the job fails.
   */
  start(kind: JobKind, request: unknown, work: () => Promise<unknown>): Job {
    if (this.jobs.countRunning() >= MAX_RUNNING_PER_USER) {
      throw new ConflictError('A few things are already in progress. Wait for them to finish.');
    }
    const action = this.allowance.reserve();
    let job: Job;
    try {
      job = this.jobs.create(kind, request);
    } catch (error) {
      action.cancel();
      throw error;
    }
    void this.run(job.id, () => action.run(work));
    return job;
  }

  find(id: number): Job | undefined {
    return this.jobs.find(id);
  }

  updateResult(id: number, result: unknown): Job {
    const job = this.jobs.find(id);
    if (!job) throw new NotFoundError('Job not found.');
    if (job.status !== 'succeeded') throw new ConflictError('This job is not ready.');
    this.jobs.succeed(id, result);
    return this.jobs.find(id)!;
  }

  recent(kind: JobKind | undefined, limit = 5): Job[] {
    return this.jobs.recent(kind, limit);
  }

  recipeHistory(limit: number, beforeId?: number): Job[] {
    return this.jobs.recipeHistory(limit, beforeId);
  }

  clearRecipeHistory(): number {
    return this.jobs.clearRecipeHistory();
  }

  private async run(id: number, work: () => Promise<unknown>): Promise<void> {
    try {
      this.jobs.succeed(id, await work());
    } catch (error) {
      if (!(error instanceof DomainError)) this.onError(error);
      this.jobs.fail(id, {
        message: error instanceof DomainError ? error.message : 'Something went wrong. Try again.',
        code: error instanceof DomainError ? error.kind : 'internal',
      });
    }
  }
}
