import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** AES-256-GCM for OAuth tokens at rest, so a copied database alone doesn't leak them. */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('TokenCipher needs a 32-byte key.');
    this.key = key;
  }

  /** From APP_SECRET if set, else a random key generated once next to the database (mode 0600). */
  static fromSecretOrFile(secret: string | undefined, keyPath: string): TokenCipher {
    if (secret) return new TokenCipher(createHash('sha256').update(secret).digest());
    if (!existsSync(keyPath)) {
      mkdirSync(dirname(keyPath), { recursive: true });
      writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    }
    chmodSync(keyPath, 0o600);
    return new TokenCipher(Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64'));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognised encrypted value.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
