import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AppSession, type CompletedSignIn } from '../../application/auth-service.ts';
import { DomainError } from '../../domain/errors.ts';
import { COOKIES, cookieOptions, isLoopback } from '../cookies.ts';
import { bodyObject } from '../params.ts';

const SIGN_IN_COOKIE_SECONDS = 10 * 60;
const ACCOUNT_HINT_SECONDS = 365 * 24 * 60 * 60;

/** @param strictLimit requests per minute per client for sign-in endpoints (brute-force guard). */
export function authRoutes(auth: AuthService, strictLimit: number): FastifyPluginAsync {
  const limited = { config: { rateLimit: { max: strictLimit, timeWindow: '1 minute' } } };
  const startSession = (request: FastifyRequest, reply: FastifyReply, session: AppSession) => {
    const sessionSeconds = Math.floor((session.sessionExpiresAt - Date.now()) / 1000);
    reply.setCookie(COOKIES.session, session.sessionToken, cookieOptions(request, sessionSeconds));
  };
  const establish = (request: FastifyRequest, reply: FastifyReply, done: CompletedSignIn) => {
    startSession(request, reply, done);
    reply.setCookie(COOKIES.account, done.accountHint, cookieOptions(request, ACCOUNT_HINT_SECONDS));
    reply.clearCookie(COOKIES.signIn, { path: '/' });
  };

  return async (app) => {
    /** Lets the front-end pick the right sign-in screen. */
    app.get('/api/auth/config', async () => ({ mode: auth.mode }));

    /** Starts "Continue with ChatGPT": remembers this browser, then redirects to OpenAI. */
    app.get('/auth/chatgpt/start', limited, async (request, reply) => {
      const query = request.query as { consent?: string };
      const started = auth.startSignIn({
        accountHint: request.cookies[COOKIES.account],
        forceConsent: query.consent === '1',
        bindingToken: request.cookies[COOKIES.signIn],
      });
      reply.setCookie(COOKIES.signIn, started.bindingToken, cookieOptions(request, SIGN_IN_COOKIE_SECONDS));
      return reply.redirect(started.authorizeUrl);
    });

    /**
     * OpenAI redirects here (http://127.0.0.1:<port>/auth/callback). It only reaches this
     * server when the browser runs on the same machine; other devices paste the URL instead.
     */
    app.get('/auth/callback', limited, async (request, reply) => {
      const params = new URLSearchParams(request.url.split('?')[1] ?? '');
      const bindingToken = request.cookies[COOKIES.signIn];
      try {
        const done = await auth.completeSignIn({
          params,
          bindingToken,
          // Only the open-source flow can land on 127.0.0.1 from a different cookie host. With a
          // registered client the callback is the public URL, and behind a tunnel every request
          // would look like loopback, so the binding cookie is always required.
          trustedWithoutBinding: auth.mode === 'local' && bindingToken === undefined && isLoopback(request.ip),
        });
        establish(request, reply, done);
        return reply.redirect('/');
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        reply.clearCookie(COOKIES.signIn, { path: '/' });
        return reply.status(400).type('text/html').send(callbackErrorPage(error.message));
      }
    });

    /** For phones/other devices: the user pastes the 127.0.0.1 address their browser ended on. */
    app.post('/api/auth/complete', limited, async (request, reply) => {
      const done = await auth.completeSignIn({
        params: AuthService.paramsFromPastedUrl(bodyObject(request.body).callbackUrl),
        bindingToken: request.cookies[COOKIES.signIn],
        trustedWithoutBinding: false,
      });
      establish(request, reply, done);
      return { ok: true, planUsageEnabled: done.planUsageEnabled };
    });

    /** A phone opened the QR link from a signed-in computer. */
    app.post('/api/auth/device-link', limited, async (request, reply) => {
      startSession(request, reply, auth.signInWithDeviceLink(bodyObject(request.body).token));
      return { ok: true };
    });

    app.post('/api/auth/sign-out', async (request, reply) => {
      const revoked = await auth.signOut(request.cookies[COOKIES.session]);
      reply.clearCookie(COOKIES.session, { path: '/' });
      return { ok: true, revoked };
    });
  };
}

function callbackErrorPage(message: string): string {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in problem · Pantry Scoop</title>
<link rel="stylesheet" href="/styles.css">
</head><body><main class="auth-error"><div class="card stack"><p class="eyebrow">PANTRY SCOOP / LET’S TRY AGAIN</p><h1>Sign-in didn’t finish</h1><p>${safe}</p><a class="button primary" href="/">Back to Pantry Scoop</a></div></main></body></html>`;
}
