import type { OpenAiIdentity } from '../domain/user.ts';

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Present on code exchange; refreshes may omit it. */
  readonly idToken: string;
  readonly scopes: readonly string[];
  readonly expiresInSeconds: number;
}

export interface AuthorizeParams {
  /** `dynamic_agent_client` for a first registration, else the issued client ID. */
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  /** `ext_agent_host_id`, for open-source (dynamically registered) clients only. */
  readonly hostId?: string;
  /** Only sent on first registration. */
  readonly agentNameHint?: string;
  readonly loginHint?: string;
  readonly idTokenHint?: string;
  /** Ask the user to review permissions again (e.g. to enable plan usage after declining). */
  readonly forceConsent?: boolean;
}

/** OpenAI's OAuth/OIDC endpoints for "Sign in with ChatGPT" (open-source client flow). */
export interface OpenAiAuth {
  authorizeUrl(params: AuthorizeParams): string;
  exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  /** Throws AuthRequiredError when the refresh token is unusable (user must sign in again). */
  refresh(input: { clientId: string; refreshToken: string }): Promise<TokenSet>;
  /** Best effort; resolves false when revocation could not be confirmed. */
  revoke(input: { clientId: string; refreshToken: string }): Promise<boolean>;
  /** Verifies signature, issuer, audience (= client ID), expiry and nonce. */
  verifyIdToken(idToken: string, expected: { clientId: string; nonce?: string }): Promise<OpenAiIdentity>;
}

export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
