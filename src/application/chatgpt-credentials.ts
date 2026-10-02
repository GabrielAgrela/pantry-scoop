import { AuthRequiredError, PlanUsageRequiredError } from '../domain/errors.ts';
import { hasTokens, planUsageEnabled, type ChatGptConnection } from '../domain/user.ts';
import type { ConnectionRepository } from '../ports/account-repositories.ts';
import type { OpenAiAuth } from '../ports/openai-auth.ts';

/** Refresh this long before expiry so a slow request doesn't start with a dying token. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

/**
 * Hands out a valid access token for a user's ChatGPT plan, refreshing (and rotating the
 * refresh token) when needed. Refreshes for one user are serialised: the refresh token
 * rotates, so two concurrent refreshes would invalidate each other.
 */
export class ChatGptCredentials {
  private readonly connections: ConnectionRepository;
  private readonly openai: OpenAiAuth;
  private readonly now: () => number;
  private readonly inFlight = new Map<number, Promise<ChatGptConnection>>();

  constructor(connections: ConnectionRepository, openai: OpenAiAuth, now: () => number = Date.now) {
    this.connections = connections;
    this.openai = openai;
    this.now = now;
  }

  async accessToken(userId: number): Promise<string> {
    const connection = this.connections.find(userId);
    if (!hasTokens(connection)) throw new AuthRequiredError('Sign in with ChatGPT again to continue.');
    if (!planUsageEnabled(connection)) {
      throw new PlanUsageRequiredError('Allow Pantry Scoop to use your ChatGPT plan to scan photos and get recipes.');
    }
    if (connection.expiresAt - REFRESH_MARGIN_MS > this.now()) return connection.accessToken;
    return (await this.refresh(userId)).accessToken;
  }

  /** The API rejected the token as invalid: forget it so the user is asked to sign in again. */
  invalidate(userId: number): void {
    this.connections.clearTokens(userId);
  }

  private refresh(userId: number): Promise<ChatGptConnection> {
    const pending = this.inFlight.get(userId);
    if (pending) return pending;
    const run = this.doRefresh(userId).finally(() => this.inFlight.delete(userId));
    this.inFlight.set(userId, run);
    return run;
  }

  private async doRefresh(userId: number): Promise<ChatGptConnection> {
    const current = this.connections.find(userId);
    if (!hasTokens(current)) throw new AuthRequiredError('Sign in with ChatGPT again to continue.');
    try {
      const tokens = await this.openai.refresh({ clientId: current.clientId, refreshToken: current.refreshToken });
      const next: ChatGptConnection = {
        ...current,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || current.refreshToken,
        idToken: tokens.idToken || current.idToken,
        scopes: tokens.scopes.length > 0 ? tokens.scopes : current.scopes,
        expiresAt: this.now() + tokens.expiresInSeconds * 1000,
      };
      this.connections.save(next);
      return next;
    } catch (error) {
      if (error instanceof AuthRequiredError) this.connections.clearTokens(userId);
      throw error;
    }
  }
}
