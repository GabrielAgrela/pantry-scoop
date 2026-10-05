import { IngredientClassificationService } from './application/ingredient-classification-service.ts';
import { AiIngredientClassifier } from './infrastructure/ai/ingredient-classification.ts';
// Composition root: the only place that knows which concrete adapters back each port.
import type { DatabaseSync } from 'node:sqlite';
import { AccountService } from './application/account-service.ts';
import { AuthService } from './application/auth-service.ts';
import { ChatGptCredentials } from './application/chatgpt-credentials.ts';
import { ProfileService } from './application/profile-service.ts';
import { RecipeService } from './application/recipe-service.ts';
import { ScanService } from './application/scan-service.ts';
import { JobService } from './application/job-service.ts';
import { DailyAiLimit } from './application/daily-ai-limit.ts';
import { LimitedModel } from './infrastructure/ai/limited-model.ts';
import { SqliteAiUsageRepository } from './infrastructure/db/sqlite-ai-usage-repository.ts';
import { InMemorySignInTransactionStore } from './application/sign-in-transactions.ts';
import { StockService } from './application/stock-service.ts';
import { APP_NAME, googleRedirectUriFor, redirectUriFor, type Config } from './config.ts';
import type { AppContainer, AppServices } from './http/app.ts';
import { ChatGptPlanModel } from './infrastructure/ai/chatgpt-plan-model.ts';
import type { StructuredModel } from './infrastructure/ai/structured-model.ts';
import { ConnectionsService } from './application/connections-service.ts';
import { SqliteLinkedAccountRepository } from './infrastructure/db/sqlite-linked-account-repository.ts';
import type { GoogleAuth } from './ports/google-auth.ts';
import { AiIngredientDetector } from './infrastructure/ai/ingredient-detection.ts';
import { CachedModelCatalog } from './infrastructure/ai/model-catalog.ts';
import { AiRecipeGenerator } from './infrastructure/ai/recipe-suggestion.ts';
import {
  hostIdentity,
  SqliteConnectionRepository,
  SqliteDeviceLinkRepository,
  SqliteSessionRepository,
  SqliteUnownedDataClaimer,
  SqliteUserRepository,
} from './infrastructure/db/sqlite-account-repositories.ts';
import { SqliteIngredientRepository } from './infrastructure/db/sqlite-ingredient-repository.ts';
import { SqliteJobRepository } from './infrastructure/db/sqlite-job-repository.ts';
import { SqliteProfileRepository } from './infrastructure/db/sqlite-profile-repository.ts';
import { SqliteSavedRecipeRepository } from './infrastructure/db/sqlite-saved-recipe-repository.ts';
import type { TokenCipher } from './infrastructure/db/token-cipher.ts';
import type { ResponsesClient } from './infrastructure/openai/responses-client.ts';
import type { OpenAiAuth } from './ports/openai-auth.ts';

export interface ContainerDeps {
  readonly config: Config;
  readonly db: DatabaseSync;
  readonly cipher: TokenCipher;
  readonly openaiAuth: OpenAiAuth;
  readonly responses: ResponsesClient;
  /** "Sign in with Google", when configured. */
  readonly googleAuth?: GoogleAuth;
  /** DeepSeek, the alternative intelligence to each person's ChatGPT plan, when configured. */
  readonly deepseek?: StructuredModel;
  readonly now?: () => number;
  /** Unexpected failures inside background jobs (for logging). */
  readonly onJobError?: (error: unknown) => void;
}

export function createContainer({ config, db, cipher, openaiAuth, responses, googleAuth, deepseek, now = Date.now, onJobError }: ContainerDeps): AppContainer {
  SqliteJobRepository.failInterrupted(db);
  const users = new SqliteUserRepository(db);
  const connections = new SqliteConnectionRepository(db, cipher);
  const credentials = new ChatGptCredentials(connections, openaiAuth, now);
  const catalog = new CachedModelCatalog(responses, credentials, undefined, now);
  const linked = new SqliteLinkedAccountRepository(db);
  const aiLimit = new DailyAiLimit(new SqliteAiUsageRepository(db), config.dailyAiLimit, now);
  const googleRedirectUri = googleAuth ? googleRedirectUriFor(config) : undefined;
  const connectionsService = new ConnectionsService(linked, connections, openaiAuth, {
    googleAvailable: googleRedirectUri !== undefined,
    deepseekAvailable: deepseek !== undefined,
  });

  const auth = new AuthService({
    users,
    connections,
    sessions: new SqliteSessionRepository(db),
    deviceLinks: new SqliteDeviceLinkRepository(db),
    openai: openaiAuth,
    google: googleAuth,
    linked,
    transactions: new InMemorySignInTransactionStore(now),
    unownedData: new SqliteUnownedDataClaimer(db),
    settings: {
      appName: APP_NAME,
      hostId: hostIdentity(db),
      redirectUri: redirectUriFor(config),
      googleRedirectUri,
      registeredClientId: config.openai.clientId,
      allowedEmails: config.allowedEmails,
      ownerEmail: config.ownerEmail,
      sessionTtlMs: config.sessionDays * 24 * 60 * 60 * 1000,
      signInTtlMs: 10 * 60 * 1000,
      deviceLinkTtlMs: 10 * 60 * 1000,
    },
    now,
  });

  /** Services are cheap to build, so each request gets a graph scoped to its user. */
  const forUser = (userId: number): AppServices => {
    // Their ChatGPT plan or DeepSeek, as they chose (automatic: the plan when it can be used).
    const onDeepSeek = deepseek !== undefined && connectionsService.aiProvider(userId) === 'deepseek';
    const model = new LimitedModel(
      onDeepSeek ? deepseek : new ChatGptPlanModel(userId, { credentials, responses, catalog, users, defaultModel: config.chatgpt.model }),
      aiLimit,
      userId,
    );
    const effort = onDeepSeek
      ? { scan: config.deepseek.scanEffort, sort: config.deepseek.sortEffort, recipe: config.deepseek.recipeEffort }
      : { scan: config.chatgpt.scanEffort, sort: config.chatgpt.scanEffort, recipe: config.chatgpt.recipeEffort };
    const stock = new StockService(new SqliteIngredientRepository(db, userId));
    const profile = new ProfileService(new SqliteProfileRepository(db, userId));
    const jobs = new SqliteJobRepository(db, userId);
    return {
      stock,
      classification: new IngredientClassificationService(new AiIngredientClassifier(model, effort.sort), stock),
      profile,
      jobs: new JobService(jobs, onJobError),
      scan: new ScanService(new AiIngredientDetector(model, effort.scan), stock),
      recipes: new RecipeService(
        new AiRecipeGenerator(model, effort.recipe),
        stock,
        profile,
        new SqliteSavedRecipeRepository(db, userId),
        jobs,
      ),
    };
  };

  return {
    auth,
    account: new AccountService(users, connections, catalog),
    connections: connectionsService,
    aiLimit,
    forUser,
    publicUrl: config.publicUrl,
  };
}
