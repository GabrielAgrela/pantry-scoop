import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { bodyObject, idParam } from '../params.ts';

export function ingredientRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => ({ ingredients: servicesOf(request).stock.list(), categories: servicesOf(request).stock.categories() }));

    app.post('/classify-other', async (request) => servicesOf(request).classification.classifyOther());

    app.post('/', async (request, reply) => {
      const body = bodyObject(request.body);
      const { ingredient, status } = servicesOf(request).stock.addManual({ name: body.name, category: body.category, notes: body.notes });
      reply.status(status === 'created' ? 201 : 200);
      return { ingredient, status };
    });

    app.patch('/:id', async (request) => {
      const body = bodyObject(request.body);
      const { name, category, notes, inStock } = body;
      return { ingredient: servicesOf(request).stock.update(idParam(request.params), { name, category, notes, inStock }) };
    });

    app.delete('/:id', async (request, reply) => {
      servicesOf(request).stock.remove(idParam(request.params));
      return reply.status(204).send();
    });
  };
}
