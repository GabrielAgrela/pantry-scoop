import type { ChatGptConnection, OpenAiIdentity, User } from '../domain/user.ts';

export interface UserRepository {
  findById(id: number): User | undefined;
  /** Looks up any of the user's OpenAI subjects (one per app registration). */
  findBySubject(issuer: string, subject: string): User | undefined;
  /** A user whose email OpenAI has verified, for linking a new registration of the same person. */
  findByVerifiedEmail(issuer: string, email: string): User | undefined;
  addIdentity(userId: number, issuer: string, subject: string): void;
  create(identity: OpenAiIdentity): User;
  updateIdentity(id: number, identity: OpenAiIdentity): User;
  setModel(id: number, model: string): User;
  markPlanWelcomeSeen(id: number): void;
  count(): number;
  /** Deletes the user and, by cascade, everything they own. */
  delete(id: number): void;
}

export interface ConnectionRepository {
  find(userId: number): ChatGptConnection | undefined;
  findByClientId(clientId: string): ChatGptConnection | undefined;
  /** Insert or replace the user's connection. */
  save(connection: ChatGptConnection): void;
  /** Forget tokens but keep the client registration for the next sign-in. */
  clearTokens(userId: number): void;
}

export interface SessionRepository {
  create(userId: number, tokenHash: string, expiresAt: number): void;
  findUserId(tokenHash: string, now: number): number | undefined;
  delete(tokenHash: string): void;
  countForUser(userId: number, now: number): number;
  extend(tokenHash: string, expiresAt: number): void;
}

/** One-time, short-lived tokens that let another device join an existing account. */
export interface DeviceLinkRepository {
  create(userId: number, tokenHash: string, expiresAt: number): void;
  /** Deletes the link and returns its user if it was still valid. */
  consume(tokenHash: string, now: number): number | undefined;
}

/** Hands data created before accounts existed to its first owner. */
export interface UnownedDataClaimer {
  claimUnowned(userId: number): void;
}
