import type { FastifyPluginAsync } from 'fastify';
import type { ConnectionsService } from '../../application/connections-service.ts';
import { bodyObject } from '../params.ts';

/** Linked sign-in providers (ChatGPT, Google) and which intelligence runs scans and recipes. */
export function connectionsRoutes(connections: ConnectionsService): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => connections.view(request.userId));
    app.put('/ai', async (request) => connections.setAiChoice(request.userId, bodyObject(request.body).provider));
    app.post('/disconnect', async (request) => connections.disconnect(request.userId, bodyObject(request.body).provider));
  };
}
