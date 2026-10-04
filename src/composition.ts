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
import { InMemorySignInTransactionStore } from './application/sign-in-transactions.ts';
import { StockService } from './application/stock-service.ts';
import { APP_NAME, redirectUriFor, type Config } from './config.ts';
import type { AppContainer, AppServices } from './http/app.ts';
import { ChatGptPlanModel } from './infrastructure/ai/chatgpt-plan-model.ts';
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
  readonly now?: () => number;
  /** Unexpected failures inside background jobs (for logging). */
  readonly onJobError?: (error: unknown) => void;
}

export function createContainer({ config, db, cipher, openaiAuth, responses, now = Date.now, onJobError }: ContainerDeps): AppContainer {
  SqliteJobRepository.failInterrupted(db);
  const users = new SqliteUserRepository(db);
  const connections = new SqliteConnectionRepository(db, cipher);
  const credentials = new ChatGptCredentials(connections, openaiAuth, now);
  const catalog = new CachedModelCatalog(responses, credentials, undefined, now);

  const auth = new AuthService({
    users,
    connections,
    sessions: new SqliteSessionRepository(db),
    deviceLinks: new SqliteDeviceLinkRepository(db),
    openai: openaiAuth,
    transactions: new InMemorySignInTransactionStore(now),
    unownedData: new SqliteUnownedDataClaimer(db),
    settings: {
      appName: APP_NAME,
      hostId: hostIdentity(db),
      redirectUri: redirectUriFor(config),
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
    const model = new ChatGptPlanModel(userId, { credentials, responses, catalog, users, defaultModel: config.chatgpt.model });
    const stock = new StockService(new SqliteIngredientRepository(db, userId));
    const profile = new ProfileService(new SqliteProfileRepository(db, userId));
    return {
      stock,
      classification: new IngredientClassificationService(new AiIngredientClassifier(model, config.chatgpt.scanEffort), stock),
      profile,
      jobs: new JobService(new SqliteJobRepository(db, userId), onJobError),
      scan: new ScanService(new AiIngredientDetector(model, config.chatgpt.scanEffort), stock),
      recipes: new RecipeService(
        new AiRecipeGenerator(model, config.chatgpt.recipeEffort),
        stock,
        profile,
        new SqliteSavedRecipeRepository(db, userId),
      ),
    };
  };

  return { auth, account: new AccountService(users, connections, catalog), forUser, publicUrl: config.publicUrl };
}
