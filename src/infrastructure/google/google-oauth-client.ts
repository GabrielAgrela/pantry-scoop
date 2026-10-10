import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AiUnavailableError, AuthRequiredError } from '../../domain/errors.ts';
import type { OpenAiIdentity } from '../../domain/user.ts';
import { GOOGLE_ISSUER, type GoogleAuth, type GoogleAuthorizeParams } from '../../ports/google-auth.ts';
import type { FetchLike } from '../openai/openai-oauth-client.ts';

/** Production values from https://accounts.google.com/.well-known/openid-configuration */
export const GOOGLE_ENDPOINTS = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google signs ID tokens with either issuer spelling. */
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class GoogleOAuthClient implements GoogleAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly jwks: JWTVerifyGetKey;
  private readonly fetch: FetchLike;

  constructor(options: { clientId: string; clientSecret: string; jwks: JWTVerifyGetKey; fetch?: FetchLike }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.jwks = options.jwks;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  authorizeUrl(params: GoogleAuthorizeParams): string {
    const url = new URL(GOOGLE_ENDPOINTS.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<string> {
    let response: Response;
    try {
      response = await this.fetch(GOOGLE_ENDPOINTS.tokenEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AiUnavailableError('Could not reach Google to finish signing in. Try again.');
    }
    const body = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!response.ok || !body.id_token) {
      const reason = [body.error ?? response.status, body.error_description].filter(Boolean).join(': ');
      throw new AuthRequiredError(`Google sign-in failed (${reason}). Start again.`);
    }
    return body.id_token;
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<OpenAiIdentity> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ISSUERS,
        audience: this.clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (payload.nonce !== nonce) throw new Error('nonce mismatch');
      if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('missing subject');
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      return {
        issuer: GOOGLE_ISSUER,
        subject: payload.sub,
        email: text(payload.email),
        emailVerified: payload.email_verified === true,
        name: text(payload.name),
        picture: text(payload.picture),
      };
    } catch {
      throw new AuthRequiredError('Your Google sign-in could not be verified. Start again.');
    }
  }
}
