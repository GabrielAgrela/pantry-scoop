import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { bodyObject, idParam } from '../params.ts';

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
