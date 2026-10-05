import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { bodyObject, idParam } from '../params.ts';
import type { Recipe } from '../../domain/recipe.ts';
import { ValidationError } from '../../domain/errors.ts';
import type { Job } from '../../domain/job.ts';

const searchText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
function matchesSearch(recipe: Recipe, query: string): boolean {
  return searchText([recipe.title, recipe.summary, recipe.kind, ...recipe.ingredients.map((item) => item.name)].join(' ')).includes(query);
}

export function recipeRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    /** Starts recipe ideas in the background; poll /api/jobs/:id for the outcome. */
    app.post('/suggestions', async (request, reply) => {
      const { recipes, jobs } = servicesOf(request);
      const plan = recipes.plan(request.body ?? {});
      const job = jobs.start('recipes', plan.request, async () => ({ recipes: await recipes.generate(plan) }));
      return reply.status(202).send({ job });
    });

    app.get('/saved', async (request) => ({ recipes: servicesOf(request).recipes.listSaved() }));

    app.get('/history', async (request) => {
      const { before, search = '' } = request.query as { before?: string; search?: string };
      if (typeof search !== 'string' || search.length > 200) throw new ValidationError('Search must be at most 200 characters.');
      const query = searchText(search.trim());
      const beforeId = before === undefined ? undefined : Number(before);
      if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) {
        throw new ValidationError('Invalid history cursor.');
      }
      const { jobs, recipes } = servicesOf(request);
      const page: Job[] = [];
      let cursor = beforeId;
      // Fill a page of matches even when the recipes are in older, unloaded batches.
      while (page.length < 11) {
        const candidates = jobs.recipeHistory(query ? 50 : 11, cursor);
        for (const job of candidates) {
          const result = job.result as { recipes: Recipe[] };
          const matches = query ? result.recipes.filter((recipe) => matchesSearch(recipe, query)) : result.recipes;
          if (!query || matches.length) page.push({ ...job, result: { recipes: matches } });
          if (page.length === 11) break;
        }
        if (!query || candidates.length < 50) break;
        cursor = candidates.at(-1)!.id;
      }
      const batches = page.slice(0, 10).map((job) => ({
        id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt,
        recipes: recipes.withCurrentStock((job.result as { recipes: Recipe[] }).recipes),
      }));
      return { batches, nextBefore: page.length > 10 ? batches.at(-1)!.id : null };
    });

    /** Forgets past idea batches; saved recipes stay, and new ideas no longer steer away from the old ones. */
    app.delete('/history', async (request, reply) => {
      servicesOf(request).jobs.clearRecipeHistory();
      return reply.status(204).send();
    });

    app.post('/saved', async (request, reply) => {
      reply.status(201);
      return { saved: servicesOf(request).recipes.save(bodyObject(request.body).recipe) };
    });

    app.delete('/saved/:id', async (request, reply) => {
      servicesOf(request).recipes.removeSaved(idParam(request.params));
      return reply.status(204).send();
    });
  };
}
