import type { OpenAiIdentity } from '../domain/user.ts';

export const GOOGLE_ISSUER = 'https://accounts.google.com';

export interface GoogleAuthorizeParams {
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/** Google's OAuth/OIDC endpoints for "Sign in with Google" (identity only, no Google APIs). */
export interface GoogleAuth {
  authorizeUrl(params: GoogleAuthorizeParams): string;
  /** Returns the ID token; throws AuthRequiredError when Google refuses the code. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<string>;
  /** Verifies signature, issuer, audience, expiry and nonce. Identity issuer is GOOGLE_ISSUER. */
  verifyIdToken(idToken: string, nonce: string): Promise<OpenAiIdentity>;
}
