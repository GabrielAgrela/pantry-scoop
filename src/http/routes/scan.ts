import type { FastifyPluginAsync } from 'fastify';
import type { ServicesOf } from '../app.ts';
import { parseImageList, IMAGE_LIMITS } from '../../domain/image.ts';
import { bodyObject, idParam } from '../params.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors.ts';
import type { ScanPreview } from '../../application/scan-service.ts';

export function scanRoutes(servicesOf: ServicesOf): FastifyPluginAsync {
  return async (app) => {
    /** Starts a background scan; poll /api/jobs/:id for the outcome. */
    app.post('/', async (request, reply) => {
      const { scan, jobs } = servicesOf(request);
      const images = parseImageList(bodyObject(request.body).images);
      const job = jobs.start('scan', { photos: images.length }, () => scan.preview(images));
      return reply.status(202).send({ job });
    });

    app.post('/:id/confirm', async (request) => {
      const { scan, jobs, stock } = servicesOf(request);
      const id = idParam(request.params);
      const job = jobs.find(id);
      if (!job || job.kind !== 'scan') throw new NotFoundError('Scan not found.');
      if (job.status !== 'succeeded') throw new ConflictError('This scan is not ready.');
      const preview = job.result as ScanPreview;
      // A retried confirmation returns the original outcome, even if stock has since changed.
      if (!preview.reviewRequired) return { job };
      return stock.transaction(() => {
        const result = scan.confirm(preview, bodyObject(request.body).ingredients);
        return { job: jobs.updateResult(id, result) };
      });
    });

    app.post('/:id/photos', async (request, reply) => {
      const { scan, jobs } = servicesOf(request);
      const source = jobs.find(idParam(request.params));
      if (!source || source.kind !== 'scan') throw new NotFoundError('Scan not found.');
      const preview = source.result as ScanPreview | null;
      if (source.status !== 'succeeded' || !preview?.reviewRequired) throw new ConflictError('This scan is not awaiting review.');
      const images = parseImageList(bodyObject(request.body).images);
      const photos = (source.request as { photos: number }).photos + images.length;
      if (photos > IMAGE_LIMITS.maxImages) throw new ValidationError(`A scan can contain up to ${IMAGE_LIMITS.maxImages} photos.`);
      const job = jobs.start('scan', { photos, reviewOf: source.id }, async () => scan.combine(preview, await scan.preview(images)));
      return reply.status(202).send({ job });
    });
  };
}
