import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, SignInRetryError, type AppSession, type CompletedSignIn } from '../../application/auth-service.ts';
import { DomainError } from '../../domain/errors.ts';
import { COOKIES, cookieOptions, isLoopback } from '../cookies.ts';
import { bodyObject } from '../params.ts';

const SIGN_IN_COOKIE_SECONDS = 10 * 60;
const ACCOUNT_HINT_SECONDS = 365 * 24 * 60 * 60;
const RETRY_CLIENT_SECONDS = 24 * 60 * 60;

/**
 * @param strictLimit requests per minute per client for sign-in endpoints (brute-force guard).
 * @param publicUrl the address registered with Google; its sign-in must start on that host so the
 *        browser cookie comes back with the callback.
 */
export function authRoutes(auth: AuthService, strictLimit: number, publicUrl?: string): FastifyPluginAsync {
  const limited = { config: { rateLimit: { max: strictLimit, timeWindow: '1 minute' } } };
  const startSession = (request: FastifyRequest, reply: FastifyReply, session: AppSession) => {
    const sessionSeconds = Math.floor((session.sessionExpiresAt - Date.now()) / 1000);
    reply.setCookie(COOKIES.session, session.sessionToken, cookieOptions(request, sessionSeconds));
  };
  const establish = (request: FastifyRequest, reply: FastifyReply, done: CompletedSignIn) => {
    startSession(request, reply, done);
    reply.setCookie(COOKIES.account, done.accountHint, cookieOptions(request, ACCOUNT_HINT_SECONDS));
    reply.clearCookie(COOKIES.signIn, { path: '/' });
    reply.clearCookie(COOKIES.retryClient, { path: '/' });
  };
  /** A signed-in browser that starts a sign-in is connecting another provider to its account. */
  const signedInUserId = (request: FastifyRequest) => auth.userForSession(request.cookies[COOKIES.session])?.id;
  const rememberRetry = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if (error instanceof SignInRetryError) {
      reply.setCookie(COOKIES.retryClient, error.issuedClientId, cookieOptions(request, RETRY_CLIENT_SECONDS));
    }
  };

  return async (app) => {
    /** Lets the front-end pick the right sign-in screen. */
    app.get('/api/auth/config', async () => ({ mode: auth.mode, google: auth.googleEnabled }));

    /** Starts "Continue with ChatGPT": remembers this browser, then redirects to OpenAI. */
    app.get('/auth/chatgpt/start', limited, async (request, reply) => {
      const query = request.query as { consent?: string };
      const started = auth.startSignIn({
        accountHint: request.cookies[COOKIES.account],
        forceConsent: query.consent === '1',
        bindingToken: request.cookies[COOKIES.signIn],
        retainedClientId: request.cookies[COOKIES.retryClient],
        linkUserId: signedInUserId(request),
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
        rememberRetry(request, reply, error);
        reply.clearCookie(COOKIES.signIn, { path: '/' });
        return reply.status(400).type('text/html').send(callbackErrorPage(error.message));
      }
    });

    /** Starts "Continue with Google" (or connects Google to the signed-in account). */
    app.get('/auth/google/start', limited, async (request, reply) => {
      const home = publicUrl ? new URL(publicUrl) : undefined;
      if (home && request.host !== home.host) return reply.redirect(`${publicUrl}/auth/google/start`);
      const started = auth.startGoogleSignIn({
        bindingToken: request.cookies[COOKIES.signIn],
        linkUserId: signedInUserId(request),
      });
      reply.setCookie(COOKIES.signIn, started.bindingToken, cookieOptions(request, SIGN_IN_COOKIE_SECONDS));
      return reply.redirect(started.authorizeUrl);
    });

    /** Google redirects here (PUBLIC_URL + /auth/google/callback) on every device. */
    app.get('/auth/google/callback', limited, async (request, reply) => {
      const params = new URLSearchParams(request.url.split('?')[1] ?? '');
      try {
        const session = await auth.completeGoogleSignIn({ params, bindingToken: request.cookies[COOKIES.signIn] });
        startSession(request, reply, session);
        reply.clearCookie(COOKIES.signIn, { path: '/' });
        return reply.redirect('/');
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        request.log.warn({ reason: error.message }, 'Google sign-in failed');
        reply.clearCookie(COOKIES.signIn, { path: '/' });
        return reply.status(400).type('text/html').send(callbackErrorPage(error.message));
      }
    });

    /** For phones/other devices: the user pastes the 127.0.0.1 address their browser ended on. */
    app.post('/api/auth/complete', limited, async (request, reply) => {
      const done = await auth
        .completeSignIn({
          params: AuthService.paramsFromPastedUrl(bodyObject(request.body).callbackUrl),
          bindingToken: request.cookies[COOKIES.signIn],
          trustedWithoutBinding: false,
        })
        .catch((error: unknown) => {
          rememberRetry(request, reply, error);
          throw error;
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
<script src="/js/theme.js"></script>
<script type="module" src="/js/translate-page.js"></script>
<link rel="stylesheet" href="/styles.css">
</head><body><main class="auth-error"><div class="card stack"><img src="/assets/scoop-jar.svg" alt="" width="96" height="112"><p class="eyebrow" data-i18n="PANTRY SCOOP / LET’S TRY AGAIN">PANTRY SCOOP / LET’S TRY AGAIN</p><h1><span data-i18n="Sign-in didn’t finish">Sign-in didn’t finish</span> <span aria-hidden="true">🫶</span></h1><p data-i18n="${safe}">${safe}</p><a class="button primary" href="/" data-i18n="Back to Pantry Scoop">Back to Pantry Scoop</a></div></main></body></html>`;
}
