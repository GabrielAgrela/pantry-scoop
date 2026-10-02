import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { parseImageList } from '../../domain/image.ts';
import { bodyObject } from '../params.ts';

export function scanRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    /** Starts a background scan; poll /api/jobs/:id for the outcome. */
    app.post('/', async (request, reply) => {
      const { scan, jobs } = servicesOf(request);
      const images = parseImageList(bodyObject(request.body).images);
      const job = jobs.start('scan', { photos: images.length }, () => scan.scan(images));
      return reply.status(202).send({ job });
    });
  };
}
