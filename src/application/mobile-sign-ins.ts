import { AuthRequiredError, ValidationError } from '../domain/errors.ts';
import { randomToken, sha256 } from './crypto.ts';

export interface MobileSignIn {
  readonly id: string;
  readonly challenge: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly provider: 'google' | 'chatgpt';
  readonly consent: boolean;
  readonly linkUserId?: number;
  userId?: number;
  codeHash?: string;
}

/** Like pending OAuth transactions, handoffs expire after ten minutes and restart with the server. */
export class MobileSignIns {
  private readonly items = new Map<string, MobileSignIn>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  start(challenge: unknown, provider: unknown, consent: unknown, linkUserId?: number): MobileSignIn {
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new ValidationError('Invalid app sign-in challenge.');
    if (provider !== 'google' && provider !== 'chatgpt') throw new ValidationError('Choose a sign-in provider.');
    for (const [id, item] of this.items) if (item.expiresAt <= this.now()) this.items.delete(id);
    if (this.items.size >= 1000) throw new ValidationError('Too many pending app sign-ins. Try again shortly.');
    const item: MobileSignIn = { id: randomToken(), nonce: randomToken(), challenge, provider, consent: consent === true, linkUserId, expiresAt: this.now() + 10 * 60 * 1000 };
    this.items.set(item.id, item);
    return item;
  }

  get(id: unknown): MobileSignIn {
    const item = typeof id === 'string' ? this.items.get(id) : undefined;
    if (!item || item.expiresAt <= this.now()) {
      if (item) this.items.delete(item.id);
      throw new AuthRequiredError('This app sign-in expired or was already used. Start again in Android.');
    }
    return item;
  }

  authenticated(id: unknown, userId: number, provider: 'chatgpt' | 'google'): void {
    const item = this.get(id);
    if (item.provider !== provider) throw new AuthRequiredError('Complete the requested sign-in provider first.');
    if (item.linkUserId !== undefined && item.linkUserId !== userId) throw new AuthRequiredError('This sign-in belongs to a different account. Start again in Android.');
    item.userId = userId;
  }

  takeGoogle(id: unknown, verifier: unknown): MobileSignIn {
    const item = this.get(id);
    if (item.provider !== 'google' || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
      || item.challenge !== sha256(verifier) || item.userId !== undefined) {
      throw new AuthRequiredError('This sign-in does not belong to this app. Start again in Android.');
    }
    // Consume before asynchronous token verification, so concurrent submissions cannot replay.
    this.items.delete(item.id);
    return item;
  }

  approve(id: unknown, userId: number): string {
    const item = this.get(id);
    if (item.userId !== userId) throw new AuthRequiredError('Complete the requested sign-in in this browser first.');
    if (item.codeHash) throw new AuthRequiredError('This app sign-in was already approved. Start again in Android.');
    const code = randomToken();
    item.codeHash = sha256(code);
    return code;
  }

  exchange(id: unknown, code: unknown, verifier: unknown): number {
    const item = this.get(id);
    if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
      || !item.codeHash || item.codeHash !== sha256(code) || item.challenge !== sha256(verifier) || item.userId === undefined) {
      throw new AuthRequiredError('This sign-in does not belong to this app. Start again in Android.');
    }
    this.items.delete(item.id);
    return item.userId;
  }
}
