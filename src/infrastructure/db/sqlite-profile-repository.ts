import type { DatabaseSync } from 'node:sqlite';
import type { KitchenProfile } from '../../domain/kitchen-profile.ts';
import type { ProfileRepository } from '../../ports/profile-repository.ts';

/** One user's kitchen profile. */
export class SqliteProfileRepository implements ProfileRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;

  constructor(db: DatabaseSync, userId: number) {
    this.db = db;
    this.userId = userId;
  }

  load(): KitchenProfile | undefined {
    const row = this.db.prepare('SELECT data FROM kitchen_profiles WHERE user_id = ?').get(this.userId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as KitchenProfile) : undefined;
  }

  save(profile: KitchenProfile): void {
    this.db
      .prepare('INSERT INTO kitchen_profiles (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data')
      .run(this.userId, JSON.stringify(profile));
  }
}
