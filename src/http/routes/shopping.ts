import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { bodyObject, idParam } from '../params.ts';

export function shoppingRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => servicesOf(request).shopping.list());

    app.post('/items', async (request, reply) => {
      reply.status(201);
      return { item: servicesOf(request).shopping.add(bodyObject(request.body) as { name: unknown }) };
    });

    app.delete('/items/:id', async (request, reply) => {
      servicesOf(request).shopping.remove(idParam(request.params));
      return reply.status(204).send();
    });

    /** Puts the item in the pantry and takes it off the list. */
    app.post('/items/:id/bought', async (request) => ({ ingredient: servicesOf(request).shopping.bought(idParam(request.params)) }));

    /** "Don't need this": hides a list entry until something new asks for it. */
    app.post('/hidden', async (request, reply) => {
      reply.status(201);
      return { hidden: servicesOf(request).shopping.hide(bodyObject(request.body) as { key: unknown; recipeIds?: unknown }) };
    });

    app.delete('/hidden/:id', async (request, reply) => {
      servicesOf(request).shopping.unhide(idParam(request.params));
      return reply.status(204).send();
    });

    app.delete('/hidden', async (request, reply) => {
      servicesOf(request).shopping.unhideAll();
      return reply.status(204).send();
    });
  };
}
