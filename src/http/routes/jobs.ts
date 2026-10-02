import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError, ValidationError } from '../../domain/errors.ts';
import { JOB_KINDS, type JobKind } from '../../domain/job.ts';
import type { ServicesOf } from '../app.ts';
import { idParam } from '../params.ts';

export function jobRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => {
      const { kind, limit } = request.query as { kind?: string; limit?: string };
      if (kind !== undefined && !JOB_KINDS.includes(kind as JobKind)) throw new ValidationError('Unknown job kind.');
      const max = Math.min(Math.max(Number(limit) || 5, 1), 20);
      return { jobs: servicesOf(request).jobs.recent(kind as JobKind | undefined, max) };
    });

    app.get('/:id', async (request) => {
      const job = servicesOf(request).jobs.find(idParam(request.params));
      if (!job) throw new NotFoundError('Job not found.');
      return { job };
    });
  };
}
