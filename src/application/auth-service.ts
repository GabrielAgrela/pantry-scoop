import { AuthRequiredError, ConflictError, ValidationError } from '../domain/errors.ts';
import { hasTokens, planUsageEnabled, type ChatGptConnection, type OpenAiIdentity, type User } from '../domain/user.ts';
import type {
  ConnectionRepository,
  DeviceLinkRepository,
  SessionRepository,
  UnownedDataClaimer,
  UserRepository,
} from '../ports/account-repositories.ts';
import type { GoogleAuth } from '../ports/google-auth.ts';
import type { LinkedAccountRepository } from '../ports/linked-account-repository.ts';
import { DYNAMIC_CLIENT_ID, type OpenAiAuth, type TokenSet } from '../ports/openai-auth.ts';
import { randomToken, sha256 } from './crypto.ts';
import type { SignInTransactionStore } from './sign-in-transactions.ts';

export interface AuthSettings {
  readonly appName: string;
  /** Stable `ext_agent_host_id` of this installation (open-source flow). */
  readonly hostId: string;
  /**
   * Open-source flow: loopback callback, e.g. http://127.0.0.1:3210/auth/callback.
   * Registered website client: the exact HTTPS callback registered with OpenAI.
   */
  readonly redirectUri: string;
  /** "Sign in with Google" callback (PUBLIC_URL + /auth/google/callback); unset = Google is off. */
  readonly googleRedirectUri?: string;
  /**
   * Client ID OpenAI issued for this website (`oaiapp_…`). When set, sign-in uses that
   * registered client and its HTTPS callback, so it works from any device. When unset, each
   * account registers dynamically via the open-source flow (loopback callback).
   */
  readonly registeredClientId?: string;
  /** Verified emails allowed to sign in (lower case). Empty = anyone with a ChatGPT account. */
  readonly allowedEmails?: readonly string[];
  /**
   * Verified email of the person who gets data created before accounts existed. Unset = the
   * first account to sign in (fine for a private install, not for a public one).
   */
  readonly ownerEmail?: string;
  readonly sessionTtlMs: number;
  readonly signInTtlMs: number;
  readonly deviceLinkTtlMs: number;
}

export interface AuthDeps {
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly sessions: SessionRepository;
  readonly deviceLinks: DeviceLinkRepository;
  readonly openai: OpenAiAuth;
  /** Present when Google sign-in is configured. */
  readonly google?: GoogleAuth;
  readonly linked: LinkedAccountRepository;
  readonly transactions: SignInTransactionStore;
  readonly unownedData: UnownedDataClaimer;
  readonly settings: AuthSettings;
  readonly now?: () => number;
}

export interface StartedSignIn {
  readonly authorizeUrl: string;
  /** Keep in an HttpOnly cookie on the starting browser; proves the callback belongs to it. */
  readonly bindingToken: string;
}

export interface AppSession {
  readonly user: User;
  readonly sessionToken: string;
  readonly sessionExpiresAt: number;
}

export interface CompletedSignIn extends AppSession {
  readonly planUsageEnabled: boolean;
  /** Issued client ID, to remember on this browser so the next sign-in reuses the registration. */
  readonly accountHint: string;
}

export interface CallbackInput {
  readonly params: URLSearchParams;
  readonly bindingToken: string | undefined;
  /**
   * True when the callback arrived without the binding cookie but from the server's own
   * machine (the loopback redirect lands on 127.0.0.1, a different cookie host).
   */
  readonly trustedWithoutBinding: boolean;
}

const CALLBACK_PATH = '/auth/callback';
const ISSUED_CLIENT_ID = /^[\w.-]{1,200}$/;

/**
 * The code exchange failed after ChatGPT issued a new registration. OpenAI's guidance: start
 * again with that issued client ID instead of registering yet another one.
 */
export class SignInRetryError extends AuthRequiredError {
  readonly issuedClientId: string;

  constructor(message: string, issuedClientId: string) {
    super(message);
    this.issuedClientId = issuedClientId;
  }
}

/** "Sign in with ChatGPT" for this app: OAuth + PKCE, account resolution and app sessions. */
export class AuthService {
  private readonly deps: AuthDeps;
  private readonly now: () => number;

  constructor(deps: AuthDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /**
   * @param options.bindingToken this browser's existing binding cookie, if any. Reusing it keeps
   *        earlier pending sign-ins from the same browser valid (e.g. the user tapped twice).
   */
  /** 'registered': website client with an HTTPS callback; 'local': open-source loopback flow. */
  get mode(): 'registered' | 'local' {
    return this.deps.settings.registeredClientId ? 'registered' : 'local';
  }

  get googleEnabled(): boolean {
    return this.deps.google !== undefined && this.deps.settings.googleRedirectUri !== undefined;
  }

  get googleClientId(): string | undefined { return this.deps.google?.clientId; }

  /**
   * @param options.retainedClientId client ID issued to this browser by a sign-in whose exchange failed.
   * @param options.linkUserId signed-in user to connect ChatGPT to, instead of signing someone in.
   */
  startSignIn(
    options: {
      accountHint?: string;
      forceConsent?: boolean;
      bindingToken?: string;
      retainedClientId?: string;
      linkUserId?: number;
    } = {},
  ): StartedSignIn {
    const { settings, openai, transactions } = this.deps;
    const registered = settings.registeredClientId;
    const link = options.linkUserId;
    // With one registered client for everyone, OpenAI's own session picks the account. Linking
    // reuses only the signed-in user's own registration, never another account's on this browser.
    const returning = registered
      ? undefined
      : link !== undefined
        ? this.deps.connections.find(link)
        : options.accountHint
          ? this.deps.connections.findByClientId(options.accountHint)
          : undefined;
    const returningUser = returning ? this.deps.users.findById(returning.userId) : undefined;
    const retained = options.retainedClientId;
    const retry = !registered && !returning && retained && retained !== DYNAMIC_CLIENT_ID && ISSUED_CLIENT_ID.test(retained) ? retained : undefined;
    const clientId = registered ?? returning?.clientId ?? retry;

    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const bindingToken = options.bindingToken || randomToken();
    transactions.put({
      state,
      provider: 'chatgpt',
      linkUserId: link,
      nonce,
      codeVerifier,
      clientId,
      expectedUserId: link === undefined ? returning?.userId : undefined,
      bindingHash: sha256(bindingToken),
      expiresAt: this.now() + settings.signInTtlMs,
    });

    const authorizeUrl = openai.authorizeUrl({
      clientId: clientId ?? DYNAMIC_CLIENT_ID,
      redirectUri: settings.redirectUri,
      state,
      nonce,
      codeChallenge: sha256(codeVerifier),
      hostId: registered ? undefined : settings.hostId,
      agentNameHint: clientId ? undefined : settings.appName,
      loginHint: returningUser?.email || undefined,
      idTokenHint: returning?.idToken || undefined,
      forceConsent: options.forceConsent,
    });
    return { authorizeUrl, bindingToken };
  }

  /** Accepts either the callback URL's query (loopback landing) or a URL pasted by the user. */
  static paramsFromPastedUrl(pasted: unknown): URLSearchParams {
    if (typeof pasted !== 'string' || pasted.trim() === '') throw new ValidationError('Paste the address your browser ended on.');
    const text = pasted.trim();
    let url: URL;
    try {
      // Some mobile browsers copy the address without its scheme.
      url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    } catch {
      throw new ValidationError('That does not look like a web address.');
    }
    if (url.pathname !== CALLBACK_PATH || !url.searchParams.has('state')) {
      throw new ValidationError(`Paste the full address that starts with http://127.0.0.1 and contains ${CALLBACK_PATH}.`);
    }
    return url.searchParams;
  }

  async completeSignIn(input: CallbackInput): Promise<CompletedSignIn> {
    const { params } = input;
    const state = params.get('state') ?? '';
    const transaction = state ? this.deps.transactions.take(state) : undefined;
    if (!transaction || transaction.provider !== 'chatgpt' || transaction.expiresAt <= this.now()) {
      throw new AuthRequiredError('This sign-in link expired or was already used. Start again.');
    }
    const bound = input.bindingToken !== undefined && sha256(input.bindingToken) === transaction.bindingHash;
    if (!bound && !(input.bindingToken === undefined && input.trustedWithoutBinding)) {
      throw new AuthRequiredError('This sign-in was started in a different browser. Start again here.');
    }
    if (params.has('error')) {
      throw new AuthRequiredError(
        params.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'ChatGPT sign-in could not be completed.',
      );
    }
    const code = params.get('code');
    if (!code) throw new AuthRequiredError('The sign-in response had no authorization code.');

    const returnedClientId = params.get('client_id') ?? undefined;
    if (transaction.clientId && returnedClientId && returnedClientId !== transaction.clientId) {
      throw new AuthRequiredError('ChatGPT returned a different app registration. Start again.');
    }
    const clientId = transaction.clientId ?? returnedClientId;
    if (!clientId || clientId === DYNAMIC_CLIENT_ID) throw new AuthRequiredError('ChatGPT did not finish registering this app.');

    const tokens = await this.deps.openai
      .exchangeCode({
        clientId,
        code,
        codeVerifier: transaction.codeVerifier,
        redirectUri: this.deps.settings.redirectUri,
      })
      .catch((error: unknown) => {
        if (!transaction.clientId && error instanceof AuthRequiredError) throw new SignInRetryError(error.message, clientId);
        throw error;
      });
    const identity = await this.deps.openai.verifyIdToken(tokens.idToken, { clientId, nonce: transaction.nonce });
    if (transaction.linkUserId !== undefined) {
      let linked: User;
      try {
        linked = this.linkIdentity(transaction.linkUserId, identity, 'ChatGPT');
      } catch (error) {
        await this.deps.openai.revoke({ clientId, refreshToken: tokens.refreshToken });
        throw error;
      }
      await this.replaceConnection(linked.id, clientId, tokens);
      return {
        ...this.openSession(linked),
        planUsageEnabled: planUsageEnabled(this.deps.connections.find(linked.id)),
        accountHint: clientId,
      };
    }
    if (!this.isAllowed(identity)) {
      await this.deps.openai.revoke({ clientId, refreshToken: tokens.refreshToken });
      throw new AuthRequiredError(`This Pantry Scoop is private. Ask its owner to add ${identity.email || 'your email'}.`);
    }

    let user = this.deps.users.findBySubject(identity.issuer, identity.subject);
    if (!user && identity.emailVerified) {
      // Same person, new registration (another browser/device): OpenAI issued a new subject.
      user = this.deps.users.findByVerifiedEmail(identity.issuer, identity.email) ?? this.userWithVerifiedEmail(identity.email);
      if (user) this.deps.users.addIdentity(user.id, identity.issuer, identity.subject);
    }
    if (transaction.expectedUserId !== undefined && user?.id !== transaction.expectedUserId) {
      throw new AuthRequiredError('You signed in with a different ChatGPT account than this browser remembers. Start again.');
    }
    if (user) {
      user = this.deps.users.updateIdentity(user.id, identity);
    } else {
      user = this.deps.users.create(identity);
      if (this.ownsLegacyData(identity)) this.deps.unownedData.claimUnowned(user.id);
    }

    await this.replaceConnection(user.id, clientId, tokens);
    return {
      ...this.openSession(user),
      planUsageEnabled: planUsageEnabled(this.deps.connections.find(user.id)),
      accountHint: clientId,
    };
  }

  /** @param options.linkUserId signed-in user to connect Google to, instead of signing someone in. */
  startGoogleSignIn(options: { bindingToken?: string; linkUserId?: number } = {}): StartedSignIn {
    const { google, settings, transactions } = this.deps;
    if (!google || !settings.googleRedirectUri) throw new ValidationError('Google sign-in is not set up on this Pantry Scoop.');
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const bindingToken = options.bindingToken || randomToken();
    transactions.put({
      state,
      provider: 'google',
      linkUserId: options.linkUserId,
      nonce,
      codeVerifier,
      clientId: undefined,
      expectedUserId: undefined,
      bindingHash: sha256(bindingToken),
      expiresAt: this.now() + settings.signInTtlMs,
    });
    const authorizeUrl = google.authorizeUrl({
      redirectUri: settings.googleRedirectUri,
      state,
      nonce,
      codeChallenge: sha256(codeVerifier),
    });
    return { authorizeUrl, bindingToken };
  }

  /** Google always returns to this site, so the browser cookie is always required. */
  async completeGoogleSignIn(input: { params: URLSearchParams; bindingToken: string | undefined }): Promise<AppSession> {
    const { google, settings } = this.deps;
    if (!google || !settings.googleRedirectUri) throw new ValidationError('Google sign-in is not set up on this Pantry Scoop.');
    const state = input.params.get('state') ?? '';
    const transaction = state ? this.deps.transactions.take(state) : undefined;
    if (!transaction || transaction.provider !== 'google' || transaction.expiresAt <= this.now()) {
      throw new AuthRequiredError('This sign-in link expired or was already used. Start again.');
    }
    if (input.bindingToken === undefined || sha256(input.bindingToken) !== transaction.bindingHash) {
      throw new AuthRequiredError('This sign-in was started in a different browser. Start again here.');
    }
    if (input.params.has('error')) {
      throw new AuthRequiredError(input.params.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in could not be completed.');
    }
    const code = input.params.get('code');
    if (!code) throw new AuthRequiredError('The sign-in response had no authorization code.');

    const idToken = await google.exchangeCode({ code, codeVerifier: transaction.codeVerifier, redirectUri: settings.googleRedirectUri });
    const identity = await google.verifyIdToken(idToken, transaction.nonce);
    return this.sessionForGoogleIdentity(identity, transaction.linkUserId);
  }

  /** Credential Manager returns an ID token; verify it exactly like the web OAuth token. */
  async completeNativeGoogleSignIn(idToken: string, nonce: string, linkUserId?: number): Promise<AppSession> {
    if (!this.googleEnabled || !this.deps.google) throw new ValidationError('Google sign-in is not set up on this Pantry Scoop.');
    const identity = await this.deps.google.verifyIdToken(idToken, nonce);
    return this.sessionForGoogleIdentity(identity, linkUserId);
  }

  private sessionForGoogleIdentity(identity: OpenAiIdentity, linkUserId?: number): AppSession {
    if (linkUserId !== undefined) return this.openSession(this.linkIdentity(linkUserId, identity, 'Google'));
    if (!this.isAllowed(identity)) {
      throw new AuthRequiredError(`This Pantry Scoop is private. Ask its owner to add ${identity.email || 'your email'}.`);
    }

    let user = this.deps.users.findBySubject(identity.issuer, identity.subject);
    if (!user && identity.emailVerified) {
      // Same verified email as an account made with ChatGPT: that is the same person.
      user = this.userWithVerifiedEmail(identity.email);
      if (user) this.deps.users.addIdentity(user.id, identity.issuer, identity.subject);
    }
    if (!user) {
      user = this.deps.users.create(identity);
      if (this.ownsLegacyData(identity)) this.deps.unownedData.claimUnowned(user.id);
    }
    return this.openSession(user);
  }

  /** Attaches a provider identity to a signed-in user; refuses one that belongs to someone else. */
  private linkIdentity(userId: number, identity: OpenAiIdentity, label: string): User {
    const owner = this.deps.users.findBySubject(identity.issuer, identity.subject);
    if (owner && owner.id !== userId) {
      throw new ConflictError(`That ${label} account already belongs to another Pantry Scoop account.`);
    }
    const user = this.deps.users.findById(userId);
    if (!user) throw new AuthRequiredError('Please sign in again.');
    this.deps.users.addIdentity(userId, identity.issuer, identity.subject);
    return user;
  }

  private userWithVerifiedEmail(email: string): User | undefined {
    const id = this.deps.linked.findUserIdByVerifiedEmail(email);
    return id === undefined ? undefined : this.deps.users.findById(id);
  }

  /** Deletes the account and everything in it, and disconnects ChatGPT. */
  async deleteAccount(userId: number): Promise<void> {
    const connection = this.deps.connections.find(userId);
    if (hasTokens(connection)) await this.deps.openai.revoke({ clientId: connection.clientId, refreshToken: connection.refreshToken });
    this.deps.users.delete(userId);
  }

  private isAllowed(identity: OpenAiIdentity): boolean {
    const allowed = this.deps.settings.allowedEmails ?? [];
    return allowed.length === 0 || (identity.emailVerified && allowed.includes(identity.email.toLowerCase()));
  }

  private ownsLegacyData(identity: OpenAiIdentity): boolean {
    const owner = this.deps.settings.ownerEmail;
    if (owner) return identity.emailVerified && identity.email.toLowerCase() === owner;
    return this.deps.users.count() === 1;
  }

  /**
   * Creates a one-time link (shown as a QR code) that signs another device in as this user.
   * This is how phones sign in: the ChatGPT callback only reaches the server's own machine.
   */
  createDeviceLink(userId: number): { token: string; expiresAt: number } {
    const token = randomToken();
    const expiresAt = this.now() + this.deps.settings.deviceLinkTtlMs;
    this.deps.deviceLinks.create(userId, sha256(token), expiresAt);
    return { token, expiresAt };
  }

  signInWithDeviceLink(token: unknown): AppSession {
    const userId = typeof token === 'string' && token ? this.deps.deviceLinks.consume(sha256(token), this.now()) : undefined;
    const user = userId === undefined ? undefined : this.deps.users.findById(userId);
    if (!user) throw new AuthRequiredError('This QR code expired or was already used. Show a new one on your computer.');
    return this.openSession(user);
  }

  /** Resolves a session; sessions in use are renewed so active users stay signed in. */
  userForSession(sessionToken: string | undefined): User | undefined {
    if (!sessionToken) return undefined;
    const hash = sha256(sessionToken);
    const userId = this.deps.sessions.findUserId(hash, this.now());
    if (userId === undefined) return undefined;
    this.deps.sessions.extend(hash, this.now() + this.deps.settings.sessionTtlMs);
    return this.deps.users.findById(userId);
  }

  private openSession(user: User): AppSession {
    const sessionToken = randomToken();
    const sessionExpiresAt = this.now() + this.deps.settings.sessionTtlMs;
    this.deps.sessions.create(user.id, sha256(sessionToken), sessionExpiresAt);
    return { user, sessionToken, sessionExpiresAt };
  }

  /**
   * Ends this browser's session. The ChatGPT tokens are revoked only when the user has no
   * other active session, so signing out on one device doesn't break another.
   * Returns false if remote revocation was attempted but not confirmed.
   */
  async signOut(sessionToken: string | undefined): Promise<boolean> {
    const user = this.userForSession(sessionToken);
    if (!sessionToken || !user) return true;
    this.deps.sessions.delete(sha256(sessionToken));
    if (this.deps.sessions.countForUser(user.id, this.now()) > 0) return true;

    const connection = this.deps.connections.find(user.id);
    if (!hasTokens(connection)) return true;
    const revoked = await this.deps.openai.revoke({ clientId: connection.clientId, refreshToken: connection.refreshToken });
    this.deps.connections.clearTokens(user.id);
    return revoked;
  }

  private async replaceConnection(userId: number, clientId: string, tokens: TokenSet): Promise<void> {
    const previous = this.deps.connections.find(userId);
    const next: ChatGptConnection = {
      userId,
      clientId,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      expiresAt: this.now() + tokens.expiresInSeconds * 1000,
    };
    this.deps.connections.save(next);
    // The previous sign-in's refresh token is now redundant; don't leave it valid.
    if (hasTokens(previous) && previous.refreshToken !== next.refreshToken) {
      await this.deps.openai.revoke({ clientId: previous.clientId, refreshToken: previous.refreshToken });
    }
  }
}
