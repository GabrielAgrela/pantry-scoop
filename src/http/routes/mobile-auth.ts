import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { AppSession, AuthService } from '../../application/auth-service.ts';
import type { MobileSignIns } from '../../application/mobile-sign-ins.ts';
import { AuthRequiredError, ValidationError } from '../../domain/errors.ts';
import { COOKIES, cookieOptions } from '../cookies.ts';
import { bodyObject } from '../params.ts';

export function mobileAuthRoutes(auth: AuthService, mobile: MobileSignIns, limited: RouteShorthandOptions,
  startSession: (request: FastifyRequest, reply: FastifyReply, session: AppSession) => void): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/auth/mobile/start', limited, async (request) => {
      const body = bodyObject(request.body);
      if (body.provider === 'google' && !auth.googleEnabled) throw new ValidationError('Google sign-in is not configured.');
      const item = mobile.start(body.challenge, body.provider, body.consent, auth.userForSession(request.cookies[COOKIES.session])?.id);
      return { flow: item.id, browserPath: `/auth/mobile?flow=${item.id}`, expiresAt: item.expiresAt,
        ...(item.provider === 'google' ? { nonce: item.nonce, serverClientId: auth.googleClientId } : {}) };
    });

    app.post('/api/auth/mobile/google', limited, async (request, reply) => {
      const body = bodyObject(request.body);
      if (typeof body.idToken !== 'string' || body.idToken.length === 0 || body.idToken.length > 16000) {
        throw new ValidationError('Google did not return a valid sign-in token.');
      }
      const item = mobile.takeGoogle(body.flow, body.verifier);
      startSession(request, reply, await auth.completeNativeGoogleSignIn(body.idToken, item.nonce, item.linkUserId));
      return { ok: true };
    });

    // The system browser owns the OAuth binding cookie; it never shares its cookies with Android.
    app.get('/auth/mobile', limited, async (request, reply) => {
      const item = mobile.get((request.query as { flow?: string }).flow);
      reply.setCookie(COOKIES.mobile, item.id, cookieOptions(request, 10 * 60));
      reply.header('Cache-Control', 'no-store');
      // The open-source ChatGPT callback is loopback-only. Use the existing phone sign-in
      // screen in this same browser, so pasted callbacks retain their OAuth binding cookie.
      if (item.provider === 'chatgpt' && auth.mode === 'local') return reply.redirect('/');
      return reply.redirect(`/auth/${item.provider}/start${item.consent ? '?consent=1' : ''}`);
    });

    app.get('/auth/mobile/finish', limited, async (request, reply) => {
      const item = mobile.get(request.cookies[COOKIES.mobile]);
      const user = auth.userForSession(request.cookies[COOKIES.session]);
      if (!user || item.userId !== user.id) return reply.redirect('/');
      const name = (user.email || user.name).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to Android · Pantry Scoop</title><script src="/js/theme.js"></script><link rel="stylesheet" href="/styles.css"><script type="module" src="/js/mobile-return.js"></script></head><body><main class="auth-error"><div class="card stack"><img src="/assets/scoop-jar.svg" width="96" height="112" alt=""><h1>Your kitchen is ready</h1><p>Continue in the Android app as <strong>${name}</strong>.</p><p id="mobile-error" class="problem" role="alert" hidden></p><button id="mobile-approve" class="primary">Continue in Android</button><a id="mobile-open" class="button primary" hidden>Open Pantry Scoop</a><p class="muted">This sign-in works once and expires after ten minutes.</p></div></main></body></html>`);
    });

    app.post('/api/auth/mobile/approve', limited, async (request, reply) => {
      const user = auth.userForSession(request.cookies[COOKIES.session]);
      if (!user) throw new AuthRequiredError('Please sign in in this browser first.');
      const item = mobile.get(request.cookies[COOKIES.mobile]);
      const code = mobile.approve(item.id, user.id);
      reply.clearCookie(COOKIES.mobile, { path: '/' });
      return { url: `pantryscoop://sign-in?flow=${item.id}&code=${code}` };
    });

    app.post('/api/auth/mobile/exchange', limited, async (request, reply) => {
      const body = bodyObject(request.body);
      const userId = mobile.exchange(body.flow, body.code, body.verifier);
      // Reuse the existing one-time device/session machinery. No OAuth tokens leave the server.
      const link = auth.createDeviceLink(userId);
      startSession(request, reply, auth.signInWithDeviceLink(link.token));
      return { ok: true };
    });
  };
}
