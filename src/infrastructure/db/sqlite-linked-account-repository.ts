import type { DatabaseSync } from 'node:sqlite';
import { AI_CHOICES, type AiChoice, type LinkedAccountRepository } from '../../ports/linked-account-repository.ts';

export class SqliteLinkedAccountRepository implements LinkedAccountRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  issuers(userId: number): string[] {
    const rows = this.db.prepare('SELECT DISTINCT issuer FROM user_identities WHERE user_id = ? ORDER BY issuer').all(userId);
    return (rows as unknown as { issuer: string }[]).map((row) => row.issuer);
  }

  removeIdentities(userId: number, issuer: string): void {
    this.db.prepare('DELETE FROM user_identities WHERE user_id = ? AND issuer = ?').run(userId, issuer);
  }

  findUserIdByVerifiedEmail(email: string): number | undefined {
    if (!email) return undefined;
    const row = this.db
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND email_verified = 1 ORDER BY id LIMIT 1')
      .get(email) as { id: number } | undefined;
    return row?.id;
  }

  deleteConnection(userId: number): void {
    this.db.prepare('DELETE FROM chatgpt_connections WHERE user_id = ?').run(userId);
  }

  aiChoice(userId: number): AiChoice {
    const row = this.db.prepare('SELECT ai_provider FROM users WHERE id = ?').get(userId) as { ai_provider: string } | undefined;
    const value = row?.ai_provider ?? '';
    return (AI_CHOICES as readonly string[]).includes(value) ? (value as AiChoice) : '';
  }

  setAiChoice(userId: number, choice: AiChoice): void {
    this.db.prepare('UPDATE users SET ai_provider = ? WHERE id = ?').run(choice, userId);
  }
}
