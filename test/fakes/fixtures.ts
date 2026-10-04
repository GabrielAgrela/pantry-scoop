import { IngredientClassificationService } from '../../src/application/ingredient-classification-service.ts';
import type { IngredientClassification, IngredientClassifier } from '../../src/ports/ingredient-classifier.ts';
import type { DatabaseSync } from 'node:sqlite';
import { AccountService } from '../../src/application/account-service.ts';
import { AuthService } from '../../src/application/auth-service.ts';
import { ConnectionsService } from '../../src/application/connections-service.ts';
import { SqliteLinkedAccountRepository } from '../../src/infrastructure/db/sqlite-linked-account-repository.ts';
import { GOOGLE_ISSUER, type GoogleAuth, type GoogleAuthorizeParams } from '../../src/ports/google-auth.ts';
import { ProfileService } from '../../src/application/profile-service.ts';
import { RecipeService } from '../../src/application/recipe-service.ts';
import { ScanService } from '../../src/application/scan-service.ts';
import { JobService } from '../../src/application/job-service.ts';
import { InMemorySignInTransactionStore } from '../../src/application/sign-in-transactions.ts';
import { StockService } from '../../src/application/stock-service.ts';
import type { ImageInput } from '../../src/domain/image.ts';
import type { Ingredient } from '../../src/domain/ingredient.ts';
import type { KitchenProfile } from '../../src/domain/kitchen-profile.ts';
import type { Recipe, SuggestionRequest } from '../../src/domain/recipe.ts';
import type { OpenAiIdentity } from '../../src/domain/user.ts';
import type { AppContainer, AppServices } from '../../src/http/app.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import {
  SqliteConnectionRepository,
  SqliteDeviceLinkRepository,
  SqliteSessionRepository,
  SqliteUnownedDataClaimer,
  SqliteUserRepository,
} from '../../src/infrastructure/db/sqlite-account-repositories.ts';
import { SqliteIngredientRepository } from '../../src/infrastructure/db/sqlite-ingredient-repository.ts';
import { SqliteJobRepository } from '../../src/infrastructure/db/sqlite-job-repository.ts';
import { SqliteProfileRepository } from '../../src/infrastructure/db/sqlite-profile-repository.ts';
import { SqliteSavedRecipeRepository } from '../../src/infrastructure/db/sqlite-saved-recipe-repository.ts';
import { TokenCipher } from '../../src/infrastructure/db/token-cipher.ts';
import type { DetectedIngredient, IngredientDetector } from '../../src/ports/ingredient-detector.ts';
import type { ModelCatalog, ModelOption } from '../../src/ports/model-catalog.ts';
import type { AuthorizeParams, OpenAiAuth, TokenSet } from '../../src/ports/openai-auth.ts';
import type { RecipeGenerator } from '../../src/ports/recipe-generator.ts';

export const FIXED_NOW = () => new Date('2026-10-02T10:00:00.000Z');

export const TINY_JPEG: ImageInput = { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
export const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG.data.toString('base64')}`;

export const TEST_CIPHER = new TokenCipher(Buffer.alloc(32, 7));
export const PLAN_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];

export function identity(subject = 'user-a', email = `${subject}@example.com`): OpenAiIdentity {
  return { issuer: 'https://auth.openai.com', subject, email, emailVerified: true, name: subject.toUpperCase(), picture: '' };
}

export function sampleRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    title: 'Ferrero-style hazelnut',
    difficulty: 'easy',
    creativity: 'familiar',
    summary: 'Nutella, cocoa and toasted hazelnuts.',
    kind: 'ice-cream',
    makes: '~750 ml mix',
    totalMinutes: 50,
    equipment: ['Ice-cream machine', 'Blender'],
    ingredients: [
      { name: 'Leite magro', amount: '350 ml', inStock: true },
      { name: 'Natas', amount: '200 ml', inStock: true },
      { name: 'Avelãs', amount: '1 handful', inStock: false },
    ],
    steps: ['Blend everything.', 'Churn 30–40 min.'],
    tips: ['1 tbsp vodka keeps it scoopable at -15 ºC.'],
    estimate: { kcalMin: 950, kcalMax: 1150, sugarGramsMin: 55, sugarGramsMax: 75, portions: 6, proteinGrams: 30, carbsGrams: 110, fatGrams: 45, fibreGrams: 4, saltGrams: 0.6 },
    ...overrides,
  };
}

/** Detector that returns a scripted answer and records what it was asked. */
export class FakeDetector implements IngredientDetector {
  answer: DetectedIngredient[] | Error = [];
  calls: { images: readonly ImageInput[]; knownNames: readonly string[] }[] = [];

  async detect(images: readonly ImageInput[], knownNames: readonly string[]): Promise<DetectedIngredient[]> {
    this.calls.push({ images, knownNames });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

export class FakeGenerator implements RecipeGenerator {
  answer: Recipe[] | Error = [sampleRecipe()];
  calls: { stock: readonly Ingredient[]; profile: KitchenProfile; request: SuggestionRequest }[] = [];

  async suggest(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest): Promise<Recipe[]> {
    this.calls.push({ stock, profile, request });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

export class FakeCatalog implements ModelCatalog {
  models: ModelOption[] = [
    { slug: 'gpt-fast', displayName: 'GPT Fast' },
    { slug: 'gpt-smart', displayName: 'GPT Smart' },
  ];
  async list(): Promise<ModelOption[]> {
    return this.models;
  }
}

/**
 * Stands in for auth.openai.com. Each exchange issues tokens for `nextIdentity`;
 * new registrations get a fresh `oaiapp_` client ID.
 */
export class FakeOpenAiAuth implements OpenAiAuth {
  nextIdentity: OpenAiIdentity = identity();
  nextScopes: string[] = PLAN_SCOPES;
  refreshResult: TokenSet | Error | undefined;
  authorizeCalls: AuthorizeParams[] = [];
  exchanges: { clientId: string; code: string; codeVerifier: string; redirectUri: string }[] = [];
  refreshes: { clientId: string; refreshToken: string }[] = [];
  revoked: { clientId: string; refreshToken: string }[] = [];
  revokeSucceeds = true;
  /** When set, the next code exchange fails with it (once). */
  exchangeError: Error | undefined;
  private counter = 0;

  authorizeUrl(params: AuthorizeParams): string {
    this.authorizeCalls.push(params);
    return `https://auth.example/authorize?state=${params.state}&client_id=${params.clientId}`;
  }

  /** The query string OpenAI would send to the callback for the latest authorize call. */
  callbackParams(overrides: Record<string, string> = {}): URLSearchParams {
    const last = this.authorizeCalls.at(-1)!;
    const params: Record<string, string> = { code: `code-${this.authorizeCalls.length}`, state: last.state };
    if (last.clientId === 'dynamic_agent_client') params.client_id = `oaiapp_${++this.counter}`;
    return new URLSearchParams({ ...params, ...overrides });
  }

  async exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet> {
    this.exchanges.push(input);
    const failure = this.exchangeError;
    this.exchangeError = undefined;
    if (failure) throw failure;
    const n = this.exchanges.length;
    return {
      accessToken: `access-${n}`,
      refreshToken: `refresh-${n}`,
      idToken: `id-${n}`,
      scopes: this.nextScopes,
      expiresInSeconds: 3600,
    };
  }

  async refresh(input: { clientId: string; refreshToken: string }): Promise<TokenSet> {
    this.refreshes.push(input);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.refreshResult instanceof Error) throw this.refreshResult;
    return (
      this.refreshResult ?? {
        accessToken: `refreshed-access-${this.refreshes.length}`,
        refreshToken: `refreshed-refresh-${this.refreshes.length}`,
        idToken: '',
        scopes: this.nextScopes,
        expiresInSeconds: 3600,
      }
    );
  }

  async revoke(input: { clientId: string; refreshToken: string }): Promise<boolean> {
    this.revoked.push(input);
    return this.revokeSucceeds;
  }

  async verifyIdToken(): Promise<OpenAiIdentity> {
    return this.nextIdentity;
  }
}

export function googleIdentity(subject = 'g-user-a', email = 'user-a@example.com'): OpenAiIdentity {
  return { issuer: GOOGLE_ISSUER, subject, email, emailVerified: true, name: `Google ${subject}`, picture: 'https://pic.example/a.png' };
}

/** Stands in for accounts.google.com: every code exchanges for `nextIdentity`. */
export class FakeGoogleAuth implements GoogleAuth {
  nextIdentity: OpenAiIdentity = googleIdentity();
  /** When set, the next exchange fails with it (once). */
  exchangeError: Error | undefined;
  authorizeCalls: GoogleAuthorizeParams[] = [];
  exchanges: { code: string; codeVerifier: string; redirectUri: string }[] = [];
  verifiedNonces: string[] = [];

  authorizeUrl(params: GoogleAuthorizeParams): string {
    this.authorizeCalls.push(params);
    return `https://accounts.example/authorize?state=${params.state}`;
  }

  callbackParams(overrides: Record<string, string> = {}): URLSearchParams {
    const last = this.authorizeCalls.at(-1)!;
    return new URLSearchParams({ code: `g-code-${this.authorizeCalls.length}`, state: last.state, ...overrides });
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<string> {
    this.exchanges.push(input);
    const failure = this.exchangeError;
    this.exchangeError = undefined;
    if (failure) throw failure;
    return `g-id-${this.exchanges.length}`;
  }

  async verifyIdToken(_idToken: string, nonce: string): Promise<OpenAiIdentity> {
    this.verifiedNonces.push(nonce);
    return this.nextIdentity;
  }
}

/** Account-level repositories over one database. */
export function accountRepos(db: DatabaseSync) {
  return {
    users: new SqliteUserRepository(db, FIXED_NOW),
    connections: new SqliteConnectionRepository(db, TEST_CIPHER, FIXED_NOW),
    sessions: new SqliteSessionRepository(db),
    deviceLinks: new SqliteDeviceLinkRepository(db),
    unownedData: new SqliteUnownedDataClaimer(db),
  };
}

export class FakeClassifier implements IngredientClassifier {
  answer: IngredientClassification[] | Error | undefined;
  calls = 0;
  delayMs = 0;
  async classify(ingredients: readonly Ingredient[]): Promise<IngredientClassification[]> {
    this.calls++;
    if (this.delayMs) await new Promise((done) => setTimeout(done, this.delayMs));
    if (this.answer instanceof Error) throw this.answer;
    return this.answer ?? ingredients.map(({ id }) => ({ id, category: 'other' }));
  }
}

/** Feature services for one user, with fake AI. */
export function servicesFor(db: DatabaseSync, userId: number, detector: FakeDetector, generator: FakeGenerator, classifier = new FakeClassifier()): AppServices {
  const stock = new StockService(new SqliteIngredientRepository(db, userId, FIXED_NOW));
  const profile = new ProfileService(new SqliteProfileRepository(db, userId));
  return {
    stock,
    classification: new IngredientClassificationService(classifier, stock),
    profile,
    jobs: new JobService(new SqliteJobRepository(db, userId, FIXED_NOW)),
    scan: new ScanService(detector, stock),
    recipes: new RecipeService(generator, stock, profile, new SqliteSavedRecipeRepository(db, userId, FIXED_NOW)),
  };
}

/** One signed-in user's services over an in-memory database (for service-level tests). */
export function buildTestServices() {
  const db = openDatabase(':memory:');
  const user = accountRepos(db).users.create(identity());
  const detector = new FakeDetector();
  const generator = new FakeGenerator();
  const classifier = new FakeClassifier();
  return { db, user, detector, generator, classifier, services: servicesFor(db, user.id, detector, generator, classifier) };
}

/** Full container (real auth + accounts over SQLite, fake OpenAI and AI) for HTTP tests. */
export function buildTestContainer(
  now: () => number = () => FIXED_NOW().getTime(),
  options: { registeredClientId?: string; allowedEmails?: string[]; ownerEmail?: string; google?: boolean; deepseek?: boolean } = {},
) {
  const db = openDatabase(':memory:');
  const repos = accountRepos(db);
  const linked = new SqliteLinkedAccountRepository(db);
  const openai = new FakeOpenAiAuth();
  const google = options.google === false ? undefined : new FakeGoogleAuth();
  const detector = new FakeDetector();
  const generator = new FakeGenerator();
  const classifier = new FakeClassifier();
  const catalog = new FakeCatalog();
  const auth = new AuthService({
    ...repos,
    openai,
    google,
    linked,
    transactions: new InMemorySignInTransactionStore(now),
    settings: {
      appName: 'Pantry Scoop',
      hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
      redirectUri: options.registeredClientId ? 'https://pantry.example.com/auth/callback' : 'http://127.0.0.1:3210/auth/callback',
      googleRedirectUri: google ? 'https://pantry.example.com/auth/google/callback' : undefined,
      registeredClientId: options.registeredClientId,
      allowedEmails: options.allowedEmails,
      ownerEmail: options.ownerEmail,
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      signInTtlMs: 10 * 60 * 1000,
      deviceLinkTtlMs: 10 * 60 * 1000,
    },
    now,
  });
  const connections = new ConnectionsService(linked, repos.connections, openai, {
    googleAvailable: google !== undefined,
    deepseekAvailable: options.deepseek !== false,
  });
  const container: AppContainer = {
    auth,
    account: new AccountService(repos.users, repos.connections, catalog),
    connections,
    forUser: (userId) => servicesFor(db, userId, detector, generator, classifier),
  };
  return { db, repos, linked, openai, google: google!, detector, generator, classifier, catalog, auth, connections, container };
}
