import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { AccountService } from '../application/account-service.ts';
import type { AuthService } from '../application/auth-service.ts';
import type { ProfileService } from '../application/profile-service.ts';
import type { RecipeService } from '../application/recipe-service.ts';
import type { ScanService } from '../application/scan-service.ts';
import type { DailyAiLimit } from '../application/daily-ai-limit.ts';
import type { JobService } from '../application/job-service.ts';
import type { IngredientClassificationService } from '../application/ingredient-classification-service.ts';
import type { ConnectionsService } from '../application/connections-service.ts';
import type { StockService } from '../application/stock-service.ts';
import { AuthRequiredError, DomainError } from '../domain/errors.ts';
import { IMAGE_LIMITS } from '../domain/image.ts';
import { MANAGE_USAGE_URL } from '../infrastructure/openai/responses-client.ts';
import { COOKIES } from './cookies.ts';
import { accountRoutes } from './routes/account.ts';
import { authRoutes } from './routes/auth.ts';
import { connectionsRoutes } from './routes/connections.ts';
import { ingredientRoutes } from './routes/ingredients.ts';
import { jobRoutes } from './routes/jobs.ts';
import { profileRoutes } from './routes/profile.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { scanRoutes } from './routes/scan.ts';
import { loggerOptions, registerSecurity } from './security.ts';

/** Feature services for one signed-in user. */
export interface AppServices {
  readonly stock: StockService;
  readonly classification: IngredientClassificationService;
  readonly scan: ScanService;
  readonly recipes: RecipeService;
  readonly profile: ProfileService;
  readonly jobs: JobService;
}

export interface AppContainer {
  readonly auth: AuthService;
  readonly account: AccountService;
  readonly forUser: (userId: number) => AppServices;
  /** Configured PUBLIC_URL, if any. */
  readonly publicUrl?: string;
  /** Linked sign-in providers and the choice of intelligence. */
  readonly connections: ConnectionsService;
  /** Each person's daily allowance of AI requests. */
  readonly aiLimit: DailyAiLimit;
}

export interface AppOptions {
  readonly publicDir?: string;
  readonly logger?: boolean;
  /** Number of reverse-proxy hops whose X-Forwarded-* headers to trust (0 = none). */
  readonly trustProxy?: number;
  /** Requests per minute per client before 429 (sign-in endpoints get a fifth of this). */
  readonly rateLimitPerMinute?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every /api route except /api/auth/* (0 = not signed in). */
    userId: number;
  }
}

/** Per-request service graph for the signed-in user. */
export type ServicesOf = (request: FastifyRequest) => AppServices;

const STATUS_BY_KIND: Record<DomainError['kind'], number> = {
  validation: 400,
  'not-found': 404,
  conflict: 409,
  'ai-unavailable': 502,
  'auth-required': 401,
  'plan-required': 403,
  'usage-limit': 429,
  'daily-limit': 429,
};

// Base64 inflates by ~4/3; leave headroom for the JSON envelope.
const BODY_LIMIT = Math.ceil(IMAGE_LIMITS.maxImages * IMAGE_LIMITS.maxBytesPerImage * 1.4);

export async function buildApp(container: AppContainer, options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ? loggerOptions : false,
    bodyLimit: BODY_LIMIT,
    // Trust exactly N proxy hops (e.g. 1 = nginx), so clients can't spoof X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < (options.trustProxy ?? 0),
  });
  await app.register(fastifyCookie);
  registerSecurity(app);
  await app.register(fastifyRateLimit, {
    max: options.rateLimitPerMinute ?? 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} s.`,
      code: 'rate-limited',
    }),
  });
  app.decorateRequest('userId', 0);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      if (request.url.startsWith('/api/auth/')) request.log.warn({ reason: error.message }, 'sign-in failed');
      const forced = (error as { statusCode?: number }).statusCode;
      return reply.status(forced ?? STATUS_BY_KIND[error.kind]).send({
        error: error.message,
        code: error.kind,
        ...(error.kind === 'usage-limit' ? { manageUsageUrl: MANAGE_USAGE_URL } : {}),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.status(status).send({ error: (error as Error).message, code: (error as { code?: string }).code });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'Something went wrong.' });
  });

  // Every /api route needs a signed-in user, except the sign-in endpoints themselves.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.url.startsWith('/api/auth/')) return;
    const user = container.auth.userForSession(request.cookies[COOKIES.session]);
    if (!user) throw new AuthRequiredError('Please sign in.');
    request.userId = user.id;
  });

  const servicesOf: ServicesOf = (request) => container.forUser(request.userId);

  const strict = Math.max(5, Math.floor((options.rateLimitPerMinute ?? 300) / 5));
  await app.register(authRoutes(container.auth, strict, container.publicUrl));
  await app.register(connectionsRoutes(container.connections), { prefix: '/api/connections' });
  await app.register(accountRoutes(container.account, container.auth, container.aiLimit, container.publicUrl), { prefix: '/api/account' });
  await app.register(ingredientRoutes(servicesOf), { prefix: '/api/ingredients' });
  await app.register(scanRoutes(servicesOf), { prefix: '/api/scan' });
  await app.register(recipeRoutes(servicesOf), { prefix: '/api/recipes' });
  await app.register(profileRoutes(servicesOf), { prefix: '/api/profile' });
  await app.register(jobRoutes(servicesOf), { prefix: '/api/jobs' });

  if (options.publicDir) await app.register(fastifyStatic, { root: options.publicDir });
  return app;
}
