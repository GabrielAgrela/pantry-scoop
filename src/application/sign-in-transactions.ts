/** A sign-in that has been started in the browser but not completed yet. */
export interface SignInTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  /** Issued client ID for a returning account, or undefined for a first registration. */
  readonly clientId: string | undefined;
  /** User expected to come back (reauthorisation), if known. */
  readonly expectedUserId: number | undefined;
  /** SHA-256 of the random value held in the starting browser's cookie. */
  readonly bindingHash: string;
  readonly expiresAt: number;
}

export interface SignInTransactionStore {
  put(transaction: SignInTransaction): void;
  /** One-time read: the transaction is removed whether or not it is still valid. */
  take(state: string): SignInTransaction | undefined;
}

/** Process-local store; pending sign-ins are short-lived (10 min) and cheap to restart. */
export class InMemorySignInTransactionStore implements SignInTransactionStore {
  private readonly items = new Map<string, SignInTransaction>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  put(transaction: SignInTransaction): void {
    this.prune();
    this.items.set(transaction.state, transaction);
  }

  take(state: string): SignInTransaction | undefined {
    const transaction = this.items.get(state);
    this.items.delete(state);
    return transaction;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, transaction] of this.items) if (transaction.expiresAt <= now) this.items.delete(state);
  }
}
