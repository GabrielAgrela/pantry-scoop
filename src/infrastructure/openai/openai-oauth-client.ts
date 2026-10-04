import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AiUnavailableError, AuthRequiredError } from '../../domain/errors.ts';
import type { OpenAiIdentity } from '../../domain/user.ts';
import type { AuthorizeParams, OpenAiAuth, TokenSet } from '../../ports/openai-auth.ts';

export interface OpenAiAuthEndpoints {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  /** Responses API resource the plan-usage token is issued for. */
  readonly resource: string;
}

/** Production values from https://auth.openai.com/.well-known/openid-configuration */
export const OPENAI_AUTH_ENDPOINTS: OpenAiAuthEndpoints = {
  issuer: 'https://auth.openai.com',
  authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
  tokenEndpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  revocationEndpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
  resource: 'https://api.openai.com/v1',
};
export const OPENAI_JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';

/** Identity scopes + permission to run Responses requests on the user's ChatGPT plan. */
export const SIGN_IN_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

/** Refresh errors that mean the token set is dead and the user must sign in again. */
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** A registered website client provisioned as confidential (`client_secret_basic`). */
export interface ConfidentialClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export class OpenAiOAuthClient implements OpenAiAuth {
  private readonly endpoints: OpenAiAuthEndpoints;
  private readonly jwks: JWTVerifyGetKey;
  private readonly fetch: FetchLike;
  private readonly scopes: string;
  private readonly confidential: ConfidentialClient | undefined;

  constructor(options: {
    endpoints?: OpenAiAuthEndpoints;
    jwks: JWTVerifyGetKey;
    fetch?: FetchLike;
    /** Override the requested scopes (e.g. as instructed by OpenAI for a registered client). */
    scopes?: string;
    confidential?: ConfidentialClient;
  }) {
    this.endpoints = options.endpoints ?? OPENAI_AUTH_ENDPOINTS;
    this.jwks = options.jwks;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.scopes = options.scopes || SIGN_IN_SCOPES;
    this.confidential = options.confidential;
  }

  authorizeUrl(params: AuthorizeParams): string {
    const query: Record<string, string> = {
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: this.scopes,
      resource: this.endpoints.resource,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    };
    if (params.hostId) query.ext_agent_host_id = params.hostId;
    if (params.agentNameHint) query.agent_name_hint = params.agentNameHint;
    if (params.loginHint) query.login_hint = params.loginHint;
    if (params.idTokenHint) query.id_token_hint = params.idTokenHint;
    if (params.forceConsent) query.prompt = 'consent';
    const url = new URL(this.endpoints.authorizationEndpoint);
    url.search = new URLSearchParams(query).toString();
    return url.toString();
  }

  async exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet> {
    const { status, body, text } = await this.post(this.endpoints.tokenEndpoint, {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      resource: this.endpoints.resource,
    }).catch(() => {
      throw new AiUnavailableError('Could not reach ChatGPT to finish signing in. Try again.');
    });
    if (status !== 200) {
      // A failed exchange carries no tokens; the raw body is the only clue to why it was refused.
      const reason = body.error_description ? `${body.error}: ${body.error_description}` : `${status} ${text.slice(0, 400)}`;
      throw new AuthRequiredError(`ChatGPT sign-in failed (${reason}). Start again.`);
    }
    const tokens = toTokenSet(body);
    if (!tokens.idToken) throw new AuthRequiredError('ChatGPT sign-in did not return an identity. Start again.');
    return tokens;
  }

  async refresh(input: { clientId: string; refreshToken: string }): Promise<TokenSet> {
    const { status, body } = await this.post(this.endpoints.tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
      resource: this.endpoints.resource,
    }).catch(() => {
      throw new AiUnavailableError('Could not reach ChatGPT. Try again in a moment.');
    });
    if (status === 200) return toTokenSet(body);
    if (body.error && TERMINAL_REFRESH_ERRORS.has(body.error)) {
      throw new AuthRequiredError('Your ChatGPT connection ended. Sign in with ChatGPT again.');
    }
    if (body.error === 'invalid_client') throw new AuthRequiredError('This app registration is no longer valid. Sign in again.');
    throw new AiUnavailableError(`ChatGPT could not renew your session (${body.error ?? status}). Try again shortly.`);
  }

  async revoke(input: { clientId: string; refreshToken: string }): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { status } = await this.post(this.endpoints.revocationEndpoint, {
          token: input.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: input.clientId,
        });
        if (status === 200) return true;
        if (status < 500) return false;
      } catch {
        // network failure: retry
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
    return false;
  }

  async verifyIdToken(idToken: string, expected: { clientId: string; nonce?: string }): Promise<OpenAiIdentity> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.endpoints.issuer,
        audience: expected.clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (expected.nonce !== undefined && payload.nonce !== expected.nonce) throw new Error('nonce mismatch');
      if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('missing subject');
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      return {
        issuer: this.endpoints.issuer,
        subject: payload.sub,
        email: text(payload.email),
        emailVerified: payload.email_verified === true,
        name: text(payload.name),
        picture: text(payload.picture),
      };
    } catch {
      throw new AuthRequiredError('Your ChatGPT sign-in could not be verified. Start again.');
    }
  }

  private async post(url: string, form: Record<string, string>): Promise<{ status: number; body: TokenResponse; text: string }> {
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
    // A confidential client authenticates with HTTP Basic only; the secret never goes in the body.
    if (this.confidential && form.client_id === this.confidential.clientId) {
      const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
      const credentials = `${encode(this.confidential.clientId)}:${encode(this.confidential.clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    const response = await this.fetch(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let body: TokenResponse = {};
    try {
      body = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      // non-JSON error page: keep the status only
    }
    return { status: response.status, body, text };
  }
}

function toTokenSet(body: TokenResponse): TokenSet {
  if (!body.access_token) throw new AuthRequiredError('ChatGPT did not return an access token. Start again.');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? '',
    idToken: body.id_token ?? '',
    scopes: (body.scope ?? '').split(' ').filter(Boolean),
    expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 3600,
  };
}
