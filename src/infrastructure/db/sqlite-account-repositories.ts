import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatGptConnection, OpenAiIdentity, User } from '../../domain/user.ts';
import type {
  ConnectionRepository,
  DeviceLinkRepository,
  SessionRepository,
  UnownedDataClaimer,
  UserRepository,
} from '../../ports/account-repositories.ts';
import type { TokenCipher } from './token-cipher.ts';

interface UserRow {
  id: number;
  issuer: string;
  subject: string;
  email: string;
  name: string;
  picture: string;
  model: string;
  plan_welcome_seen: number;
  created_at: string;
}

const USER_COLUMNS = 'id, issuer, subject, email, name, picture, model, plan_welcome_seen, created_at';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    name: row.name,
    picture: row.picture,
    model: row.model,
    planWelcomeSeen: row.plan_welcome_seen === 1,
    createdAt: row.created_at,
  };
}

export class SqliteUserRepository implements UserRepository {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  findById(id: number): User | undefined {
    const row = this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
    return row ? toUser(row as unknown as UserRow) : undefined;
  }

  findBySubject(issuer: string, subject: string): User | undefined {
    const row = this.db
      .prepare(
        `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')} FROM users u
         JOIN user_identities i ON i.user_id = u.id WHERE i.issuer = ? AND i.subject = ?`,
      )
      .get(issuer, subject);
    return row ? toUser(row as unknown as UserRow) : undefined;
  }

  findByVerifiedEmail(issuer: string, email: string): User | undefined {
    if (!email) return undefined;
    const row = this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE issuer = ? AND lower(email) = lower(?) AND email_verified = 1 ORDER BY id LIMIT 1`)
      .get(issuer, email);
    return row ? toUser(row as unknown as UserRow) : undefined;
  }

  addIdentity(userId: number, issuer: string, subject: string): void {
    this.db.prepare('INSERT OR IGNORE INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)').run(issuer, subject, userId);
  }

  create(identity: OpenAiIdentity): User {
    const row = this.db
      .prepare(
        `INSERT INTO users (issuer, subject, email, email_verified, name, picture, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${USER_COLUMNS}`,
      )
      .get(
        identity.issuer,
        identity.subject,
        identity.email,
        identity.emailVerified ? 1 : 0,
        identity.name,
        identity.picture,
        this.now().toISOString(),
      );
    const user = toUser(row as unknown as UserRow);
    this.addIdentity(user.id, identity.issuer, identity.subject);
    return user;
  }

  updateIdentity(id: number, identity: OpenAiIdentity): User {
    const row = this.db
      .prepare(`UPDATE users SET email = ?, email_verified = ?, name = ?, picture = ? WHERE id = ? RETURNING ${USER_COLUMNS}`)
      .get(identity.email, identity.emailVerified ? 1 : 0, identity.name, identity.picture, id);
    return toUser(row as unknown as UserRow);
  }

  setModel(id: number, model: string): User {
    const row = this.db.prepare(`UPDATE users SET model = ? WHERE id = ? RETURNING ${USER_COLUMNS}`).get(model, id);
    return toUser(row as unknown as UserRow);
  }

  markPlanWelcomeSeen(id: number): void {
    this.db.prepare('UPDATE users SET plan_welcome_seen = 1 WHERE id = ?').run(id);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

interface ConnectionRow {
  user_id: number;
  client_id: string;
  secrets: string;
  scopes: string;
  expires_at: number;
}

interface Secrets {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

const NO_SECRETS: Secrets = { idToken: '', accessToken: '', refreshToken: '' };

/** Stores each user's ChatGPT registration; tokens are encrypted at rest. */
export class SqliteConnectionRepository implements ConnectionRepository {
  private readonly db: DatabaseSync;
  private readonly cipher: TokenCipher;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, cipher: TokenCipher, now: () => Date = () => new Date()) {
    this.db = db;
    this.cipher = cipher;
    this.now = now;
  }

  find(userId: number): ChatGptConnection | undefined {
    const row = this.db.prepare('SELECT * FROM chatgpt_connections WHERE user_id = ?').get(userId);
    return row ? this.toConnection(row as unknown as ConnectionRow) : undefined;
  }

  findByClientId(clientId: string): ChatGptConnection | undefined {
    const row = this.db.prepare('SELECT * FROM chatgpt_connections WHERE client_id = ?').get(clientId);
    return row ? this.toConnection(row as unknown as ConnectionRow) : undefined;
  }

  save(connection: ChatGptConnection): void {
    const secrets: Secrets = {
      idToken: connection.idToken,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
    };
    this.db
      .prepare(
        `INSERT INTO chatgpt_connections (user_id, client_id, secrets, scopes, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET client_id = excluded.client_id, secrets = excluded.secrets,
           scopes = excluded.scopes, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .run(
        connection.userId,
        connection.clientId,
        this.cipher.encrypt(JSON.stringify(secrets)),
        connection.scopes.join(' '),
        connection.expiresAt,
        this.now().toISOString(),
      );
  }

  clearTokens(userId: number): void {
    // The ID token is kept as a hint for the next sign-in; access/refresh tokens are dropped.
    const current = this.find(userId);
    if (!current) return;
    this.save({ ...current, accessToken: '', refreshToken: '', scopes: [], expiresAt: 0 });
  }

  private toConnection(row: ConnectionRow): ChatGptConnection {
    let secrets = NO_SECRETS;
    try {
      secrets = JSON.parse(this.cipher.decrypt(row.secrets)) as Secrets;
    } catch {
      // Key changed or data corrupted: treat as signed out rather than crashing.
    }
    return {
      userId: row.user_id,
      clientId: row.client_id,
      ...secrets,
      scopes: row.scopes.split(' ').filter(Boolean),
      expiresAt: row.expires_at,
    };
  }
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(userId: number, tokenHash: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt);
  }

  findUserId(tokenHash: string, now: number): number | undefined {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now) as
      | { user_id: number }
      | undefined;
    return row?.user_id;
  }

  delete(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  extend(tokenHash: string, expiresAt: number): void {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
  }

  countForUser(userId: number, now: number): number {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId) as { n: number }).n;
  }
}

export class SqliteDeviceLinkRepository implements DeviceLinkRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(userId: number, tokenHash: string, expiresAt: number): void {
    this.db.prepare('DELETE FROM device_links WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('INSERT INTO device_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt);
  }

  consume(tokenHash: string, now: number): number | undefined {
    const row = this.db.prepare('DELETE FROM device_links WHERE token_hash = ? RETURNING user_id, expires_at').get(tokenHash) as
      | { user_id: number; expires_at: number }
      | undefined;
    return row && row.expires_at > now ? row.user_id : undefined;
  }
}

/** Data from before accounts existed (user_id NULL) goes to the first account. */
export class SqliteUnownedDataClaimer implements UnownedDataClaimer {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  claimUnowned(userId: number): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE ingredients SET user_id = ? WHERE user_id IS NULL').run(userId);
      this.db.prepare('UPDATE saved_recipes SET user_id = ? WHERE user_id IS NULL').run(userId);
      const legacy = this.db.prepare("SELECT value FROM settings WHERE key = 'kitchen_profile'").get() as { value: string } | undefined;
      if (legacy) {
        this.db.prepare('INSERT OR IGNORE INTO kitchen_profiles (user_id, data) VALUES (?, ?)').run(userId, legacy.value);
        this.db.prepare("DELETE FROM settings WHERE key = 'kitchen_profile'").run();
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** This installation's stable `ext_agent_host_id`, created once and kept in the database. */
export function hostIdentity(db: DatabaseSync): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ext_agent_host_id'").get() as { value: string } | undefined;
  if (row) return row.value;
  const hostId = `urn:uuid:${randomUUID()}`;
  db.prepare("INSERT INTO settings (key, value) VALUES ('ext_agent_host_id', ?)").run(hostId);
  return hostId;
}
