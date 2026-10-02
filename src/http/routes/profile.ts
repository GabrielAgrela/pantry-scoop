import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';

export function profileRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => ({ profile: servicesOf(request).profile.get() }));
    app.put('/', async (request) => ({ profile: servicesOf(request).profile.update(request.body) }));
    app.post('/reset', async (request) => ({ profile: servicesOf(request).profile.reset() }));
  };
}
