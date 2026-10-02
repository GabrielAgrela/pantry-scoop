import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const NAME = /^auto-(\d{4}-\d{2}-\d{2})\.db$/;

/**
 * Writes one consistent snapshot per day (`VACUUM INTO`, safe while the app runs) and keeps
 * the newest `keep` of them. Returns the snapshot path, or undefined if today's exists.
 */
export function backupNow(db: DatabaseSync, dir: string, keep: number, today = new Date()): string | undefined {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `auto-${today.toISOString().slice(0, 10)}.db`);
  let created: string | undefined;
  if (!existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    created = file;
  }
  const snapshots = readdirSync(dir).filter((name) => NAME.test(name)).sort().reverse();
  for (const old of snapshots.slice(keep)) rmSync(join(dir, old));
  return created;
}

/** Backs up at start and then every few hours (a new file only appears once per day). */
export function scheduleBackups(db: DatabaseSync, dir: string, keep: number, onError: (error: unknown) => void): () => void {
  if (keep <= 0) return () => {};
  const run = () => {
    try {
      backupNow(db, dir, keep);
    } catch (error) {
      onError(error);
    }
  };
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
