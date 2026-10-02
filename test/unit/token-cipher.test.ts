import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TokenCipher } from '../../src/infrastructure/db/token-cipher.ts';

describe('TokenCipher', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 1));
    const a = cipher.encrypt('secret');
    assert.notEqual(a, cipher.encrypt('secret'));
    assert.equal(cipher.decrypt(a), 'secret');
  });

  it('detects tampering and wrong keys', () => {
    const sealed = new TokenCipher(Buffer.alloc(32, 1)).encrypt('secret');
    assert.throws(() => new TokenCipher(Buffer.alloc(32, 2)).decrypt(sealed));
    const parts = sealed.split('.');
    parts[3] = parts[3]!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    assert.throws(() => new TokenCipher(Buffer.alloc(32, 1)).decrypt(parts.join('.')));
  });

  it('creates a private key file once, or derives the key from APP_SECRET', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-key-'));
    try {
      const path = join(dir, 'secret.key');
      const sealed = TokenCipher.fromSecretOrFile(undefined, path).encrypt('x');
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(TokenCipher.fromSecretOrFile(undefined, path).decrypt(sealed), 'x');
      const fromSecret = TokenCipher.fromSecretOrFile('pass', path);
      assert.equal(TokenCipher.fromSecretOrFile('pass', '/nonexistent').decrypt(fromSecret.encrypt('y')), 'y');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
