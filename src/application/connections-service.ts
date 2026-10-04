import { ConflictError, ValidationError } from '../domain/errors.ts';
import { hasTokens, planUsageEnabled } from '../domain/user.ts';
import type { ConnectionRepository } from '../ports/account-repositories.ts';
import { GOOGLE_ISSUER } from '../ports/google-auth.ts';
import { AI_CHOICES, type AiChoice, type LinkedAccountRepository, type Provider } from '../ports/linked-account-repository.ts';
import type { OpenAiAuth } from '../ports/openai-auth.ts';

export const OPENAI_ISSUER = 'https://auth.openai.com';

export type AiProvider = 'chatgpt' | 'deepseek';

export interface ConnectionsView {
  /** Sign-in providers linked to this account. */
  readonly chatgpt: boolean;
  readonly google: boolean;
  /** Whether this Pantry Scoop offers Google sign-in at all. */
  readonly googleAvailable: boolean;
  /** ChatGPT is linked and its plan can be used for scans and recipes. */
  readonly chatgptPlan: boolean;
  readonly deepseekAvailable: boolean;
  /** What the person picked ('' = automatic). */
  readonly aiChoice: AiChoice;
  /** What actually runs their scans and recipes. */
  readonly aiProvider: AiProvider;
}

export interface ConnectionsSettings {
  readonly googleAvailable: boolean;
  readonly deepseekAvailable: boolean;
}

/** Linked sign-in providers and the choice of intelligence for one account. */
export class ConnectionsService {
  private readonly linked: LinkedAccountRepository;
  private readonly connections: ConnectionRepository;
  private readonly openai: OpenAiAuth;
  private readonly settings: ConnectionsSettings;

  constructor(linked: LinkedAccountRepository, connections: ConnectionRepository, openai: OpenAiAuth, settings: ConnectionsSettings) {
    this.linked = linked;
    this.connections = connections;
    this.openai = openai;
    this.settings = settings;
  }

  view(userId: number): ConnectionsView {
    const issuers = this.linked.issuers(userId);
    const chatgptPlan = planUsageEnabled(this.connections.find(userId));
    const aiChoice = this.linked.aiChoice(userId);
    return {
      chatgpt: issuers.includes(OPENAI_ISSUER),
      google: issuers.includes(GOOGLE_ISSUER),
      googleAvailable: this.settings.googleAvailable,
      chatgptPlan,
      deepseekAvailable: this.settings.deepseekAvailable,
      aiChoice,
      aiProvider: this.resolve(aiChoice, chatgptPlan),
    };
  }

  /** The intelligence this person's scans and recipes run on right now. */
  aiProvider(userId: number): AiProvider {
    return this.resolve(this.linked.aiChoice(userId), planUsageEnabled(this.connections.find(userId)));
  }

  setAiChoice(userId: number, choice: unknown): ConnectionsView {
    if (typeof choice !== 'string' || !(AI_CHOICES as readonly string[]).includes(choice)) {
      throw new ValidationError('Choose ChatGPT, DeepSeek or automatic.');
    }
    if (choice === 'deepseek' && !this.settings.deepseekAvailable) {
      throw new ValidationError('DeepSeek is not set up on this Pantry Scoop.');
    }
    this.linked.setAiChoice(userId, choice as AiChoice);
    return this.view(userId);
  }

  /** Unlinks a sign-in provider; the account must keep at least one way to sign in. */
  async disconnect(userId: number, provider: unknown): Promise<ConnectionsView> {
    if (provider !== 'chatgpt' && provider !== 'google') throw new ValidationError('Choose ChatGPT or Google.');
    const issuer = provider === 'chatgpt' ? OPENAI_ISSUER : GOOGLE_ISSUER;
    const issuers = this.linked.issuers(userId);
    if (!issuers.includes(issuer)) return this.view(userId);
    if (issuers.every((other) => other === issuer)) {
      throw new ConflictError(`Connect another way to sign in before disconnecting ${label(provider)}.`);
    }
    if (provider === 'chatgpt') {
      const connection = this.connections.find(userId);
      if (hasTokens(connection)) await this.openai.revoke({ clientId: connection.clientId, refreshToken: connection.refreshToken });
      this.linked.deleteConnection(userId);
    }
    this.linked.removeIdentities(userId, issuer);
    return this.view(userId);
  }

  private resolve(choice: AiChoice, chatgptPlan: boolean): AiProvider {
    if (choice === 'deepseek' && this.settings.deepseekAvailable) return 'deepseek';
    if (choice === 'chatgpt') return 'chatgpt';
    return chatgptPlan || !this.settings.deepseekAvailable ? 'chatgpt' : 'deepseek';
  }
}

function label(provider: Provider): string {
  return provider === 'chatgpt' ? 'ChatGPT' : 'Google';
}
