import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError, ValidationError } from '../../domain/errors.ts';
import { JOB_KINDS, type JobKind } from '../../domain/job.ts';
import type { Job } from '../../domain/job.ts';
import type { Recipe } from '../../domain/recipe.ts';
import type { RecipeService } from '../../application/recipe-service.ts';
import type { ServicesOf } from '../app.ts';
import { idParam } from '../params.ts';

function currentRecipeStock(job: Job, recipes: RecipeService): Job {
  if (job.kind !== 'recipes' || job.status !== 'succeeded') return job;
  const result = job.result as { recipes: Recipe[] };
  return { ...job, result: { ...result, recipes: recipes.withCurrentStock(result.recipes) } };
}

export function jobRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => {
      const { kind, limit } = request.query as { kind?: string; limit?: string };
      if (kind !== undefined && !JOB_KINDS.includes(kind as JobKind)) throw new ValidationError('Unknown job kind.');
      const max = Math.min(Math.max(Number(limit) || 5, 1), 20);
      const { jobs, recipes } = servicesOf(request);
      return { jobs: jobs.recent(kind as JobKind | undefined, max).map((job) => currentRecipeStock(job, recipes)) };
    });

    app.get('/:id', async (request) => {
      const { jobs, recipes } = servicesOf(request);
      const job = jobs.find(idParam(request.params));
      if (!job) throw new NotFoundError('Job not found.');
      return { job: currentRecipeStock(job, recipes) };
    });
  };
}
