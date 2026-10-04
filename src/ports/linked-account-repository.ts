/** Which intelligence runs scans and recipes: '' = automatic (ChatGPT plan when usable, else DeepSeek). */
export type AiChoice = '' | 'chatgpt' | 'deepseek';
export const AI_CHOICES: readonly AiChoice[] = ['', 'chatgpt', 'deepseek'];

/** Sign-in providers a person can link to one Pantry Scoop account. */
export type Provider = 'chatgpt' | 'google';

/** Account-level linking data that sits beside the user record. */
export interface LinkedAccountRepository {
  /** Issuers (e.g. https://accounts.google.com) with at least one identity for this user. */
  issuers(userId: number): string[];
  removeIdentities(userId: number, issuer: string): void;
  /** Oldest user whose email is verified, whatever provider verified it. */
  findUserIdByVerifiedEmail(email: string): number | undefined;
  /** Forget the ChatGPT registration and its tokens. */
  deleteConnection(userId: number): void;
  aiChoice(userId: number): AiChoice;
  setAiChoice(userId: number, choice: AiChoice): void;
}
