/** A person using this app, identified by their verified ChatGPT (OpenAI) account. */
export interface User {
  readonly id: number;
  readonly issuer: string;
  /** Stable OpenAI subject (`sub`). */
  readonly subject: string;
  readonly email: string;
  readonly name: string;
  readonly picture: string;
  /** Preferred model slug; empty = the first model their plan offers. */
  readonly model: string;
  readonly planWelcomeSeen: boolean;
  readonly createdAt: string;
}

/** Verified claims from an OpenAI ID token. */
export interface OpenAiIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
  /** OpenAI confirmed the user owns `email` (required for allowlist and owner checks). */
  readonly emailVerified: boolean;
  readonly name: string;
  readonly picture: string;
}

export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';

/**
 * One user's ChatGPT registration and OAuth tokens. Tokens are absent after sign-out
 * or a terminal refresh failure; the client registration is kept for the next sign-in.
 */
export interface ChatGptConnection {
  readonly userId: number;
  /** Issued OAuth client (`oaiapp_…`) from dynamic registration. */
  readonly clientId: string;
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  /** Epoch ms when the access token expires. */
  readonly expiresAt: number;
}

export function hasTokens(connection: ChatGptConnection | undefined): connection is ChatGptConnection {
  return !!connection && connection.accessToken !== '' && connection.refreshToken !== '';
}

export function planUsageEnabled(connection: ChatGptConnection | undefined): boolean {
  return hasTokens(connection) && connection.scopes.includes(PLAN_USAGE_SCOPE);
}
