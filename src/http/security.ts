import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../domain/errors.ts';

/**
 * Locked-down browser policy: only our own scripts/styles, no framing, no inline code.
 * Images may be data: (QR code, photo previews) or https: (ChatGPT profile pictures).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (request.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // CSRF defence in depth (cookies are already SameSite=Lax and bodies JSON-only):
  // a browser sending a state-changing request from another site is refused.
  app.addHook('onRequest', async (request) => {
    if (!MUTATING.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin === undefined) return; // non-browser clients
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ValidationError('Bad origin.');
    }
    if (originHost !== request.headers.host) {
      const error = new ValidationError('Cross-site request refused.');
      throw Object.assign(error, { statusCode: 403 });
    }
  });
}

/** Logs request paths without query strings (OAuth codes and state live there). */
export const loggerOptions = {
  serializers: {
    req: (request: { method: string; url: string; ip?: string }) => ({
      method: request.method,
      url: request.url.split('?')[0],
      ip: request.ip,
    }),
  },
};
