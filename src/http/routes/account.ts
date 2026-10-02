import type { FastifyPluginAsync } from 'fastify';
import QRCode from 'qrcode';
import type { AccountService } from '../../application/account-service.ts';
import type { AuthService } from '../../application/auth-service.ts';
import { ValidationError } from '../../domain/errors.ts';
import { MANAGE_USAGE_URL } from '../../infrastructure/openai/responses-client.ts';
import { bodyObject } from '../params.ts';
import { COOKIES } from '../cookies.ts';
import { phoneBaseUrl } from '../public-url.ts';

export function accountRoutes(account: AccountService, auth: AuthService, publicUrl: string | undefined): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request) => ({ ...account.view(request.userId), manageUsageUrl: MANAGE_USAGE_URL }));
    app.get('/models', async (request) => ({ models: await account.models(request.userId) }));
    app.put('/model', async (request) => account.setModel(request.userId, bodyObject(request.body).model));
    /** QR code that signs a phone in to this account (the token travels in the URL fragment). */
    app.post('/device-links', async (request) => {
      const base = phoneBaseUrl(request, publicUrl);
      if (!base) throw new ValidationError('Could not work out this computer’s network address. Set PUBLIC_URL in .env.');
      const { token, expiresAt } = auth.createDeviceLink(request.userId);
      const url = `${base}/#link=${token}`;
      const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      return { url, expiresAt, qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
    });

    /** Deletes the account and all its data; disconnects ChatGPT. */
    app.delete('/', async (request, reply) => {
      await auth.deleteAccount(request.userId);
      reply.clearCookie(COOKIES.session, { path: '/' });
      return reply.status(204).send();
    });

    app.post('/plan-welcome/dismiss', async (request, reply) => {
      account.dismissPlanWelcome(request.userId);
      return reply.status(204).send();
    });
  };
}
