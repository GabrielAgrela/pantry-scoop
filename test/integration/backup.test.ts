import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { backupNow } from '../../src/infrastructure/db/backup.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';

describe('backupNow', () => {
  it('writes one readable snapshot per day and keeps the newest N', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-backup-'));
    try {
      const db = openDatabase(join(dir, 'pantry.db'));
      db.exec("INSERT INTO settings (key, value) VALUES ('probe', 'ok')");
      const backups = join(dir, 'backups');
      const first = backupNow(db, backups, 2, new Date('2026-10-01T10:00:00Z'));
      assert.equal(backupNow(db, backups, 2, new Date('2026-10-01T20:00:00Z')), undefined, 'once per day');
      backupNow(db, backups, 2, new Date('2026-10-02T10:00:00Z'));
      backupNow(db, backups, 2, new Date('2026-10-03T10:00:00Z'));
      writeFileSync(join(backups, 'manual.db'), 'kept');

      assert.deepEqual(readdirSync(backups).sort(), ['auto-2026-10-02.db', 'auto-2026-10-03.db', 'manual.db']);
      assert.ok(first);
      const copy = new DatabaseSync(join(backups, 'auto-2026-10-03.db'));
      assert.deepEqual({ ...(copy.prepare("SELECT value FROM settings WHERE key = 'probe'").get() as object) }, { value: 'ok' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
