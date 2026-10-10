import type { DatabaseSync } from 'node:sqlite';
import { LEGACY_PROFILE as DEFAULT_PROFILE, type Appliance, type KitchenProfile } from '../../domain/kitchen-profile.ts';
import { ingredientEmoji } from '../../domain/ingredient-emoji.ts';
import type { Category } from '../../domain/ingredient.ts';

export type Migration = string | ((db: DatabaseSync) => void);

/**
 * Ordered, append-only schema/data migrations. Never edit a shipped entry:
 * add a new one, so existing databases upgrade in place.
 */
export const MIGRATIONS: readonly Migration[] = [
  // 1 — initial schema (ice-cream only).
  `CREATE TABLE ingredients (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT NOT NULL,
     normalized_name TEXT NOT NULL UNIQUE,
     category        TEXT NOT NULL,
     notes           TEXT NOT NULL DEFAULT '',
     source          TEXT NOT NULL,
     created_at      TEXT NOT NULL
   );
   CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE saved_recipes (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     data       TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,

  // 2 — general cooking: broader categories, appliance-based profile, generic recipe shape.
  (db) => {
    db.exec(`UPDATE ingredients SET category = 'baking' WHERE category = 'thickener';
             UPDATE ingredients SET category = 'snacks' WHERE category = 'biscuits';`);

    const profileRow = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_profile'").get() as { value: string } | undefined;
    if (profileRow) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'kitchen_profile'").run(
        JSON.stringify(upgradeIceCreamProfile(JSON.parse(profileRow.value) as LegacyProfile)),
      );
    }

    const rows = db.prepare('SELECT id, data FROM saved_recipes').all() as unknown as { id: number; data: string }[];
    const update = db.prepare('UPDATE saved_recipes SET data = ? WHERE id = ?');
    for (const row of rows) update.run(JSON.stringify(upgradeIceCreamRecipe(JSON.parse(row.data) as LegacyRecipe)), row.id);
  },

  // 3 — "ran out" flag: items stay known (name, notes) while out of stock.
  `ALTER TABLE ingredients ADD COLUMN in_stock INTEGER NOT NULL DEFAULT 1;`,

  // 4 — accounts ("Sign in with ChatGPT"). Existing rows get user_id NULL and are
  //     claimed by the first account that signs in (see SqliteUnownedDataClaimer).
  `CREATE TABLE users (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     issuer            TEXT NOT NULL,
     subject           TEXT NOT NULL,
     email             TEXT NOT NULL DEFAULT '',
     name              TEXT NOT NULL DEFAULT '',
     picture           TEXT NOT NULL DEFAULT '',
     model             TEXT NOT NULL DEFAULT '',
     plan_welcome_seen INTEGER NOT NULL DEFAULT 0,
     created_at        TEXT NOT NULL,
     UNIQUE (issuer, subject)
   );
   CREATE TABLE chatgpt_connections (
     user_id    INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
     client_id  TEXT NOT NULL,
     secrets    TEXT NOT NULL,          -- encrypted JSON: id/access/refresh tokens
     scopes     TEXT NOT NULL DEFAULT '',
     expires_at INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX chatgpt_connections_client ON chatgpt_connections (client_id);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions (user_id);
   CREATE TABLE kitchen_profiles (
     user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
     data    TEXT NOT NULL
   );

   CREATE TABLE ingredients_v4 (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id         INTEGER REFERENCES users (id) ON DELETE CASCADE,
     name            TEXT NOT NULL,
     normalized_name TEXT NOT NULL,
     category        TEXT NOT NULL,
     notes           TEXT NOT NULL DEFAULT '',
     source          TEXT NOT NULL,
     in_stock        INTEGER NOT NULL DEFAULT 1,
     created_at      TEXT NOT NULL,
     UNIQUE (user_id, normalized_name)
   );
   INSERT INTO ingredients_v4 (id, user_id, name, normalized_name, category, notes, source, in_stock, created_at)
     SELECT id, NULL, name, normalized_name, category, notes, source, in_stock, created_at FROM ingredients;
   DROP TABLE ingredients;
   ALTER TABLE ingredients_v4 RENAME TO ingredients;

   ALTER TABLE saved_recipes ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
   CREATE INDEX saved_recipes_user ON saved_recipes (user_id);`,

  // 5 — one-time links that sign a phone in as an already signed-in user (QR code).
  `CREATE TABLE device_links (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );`,

  // 6 — background jobs (photo scans, recipe ideas) so results survive reloads.
  `CREATE TABLE jobs (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     kind        TEXT NOT NULL,
     status      TEXT NOT NULL,
     request     TEXT NOT NULL,
     result      TEXT,
     error       TEXT,
     created_at  TEXT NOT NULL,
     finished_at TEXT
   );
   CREATE INDEX jobs_user ON jobs (user_id, id);`,

  // 7 — OpenAI issues a different subject per app registration (each browser that signs in
  //     without a saved registration), so one person can have several. Map them all to one user,
  //     and remember whether the email was verified (needed to link registrations safely).
  `CREATE TABLE user_identities (
     issuer  TEXT NOT NULL,
     subject TEXT NOT NULL,
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     PRIMARY KEY (issuer, subject)
   );
   INSERT INTO user_identities (issuer, subject, user_id) SELECT issuer, subject, id FROM users;
   ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX users_email ON users (issuer, email);`,

  // 8 — persisted food emojis, including every existing owner's stocked and run-out ingredients.
  (db) => {
    db.exec("ALTER TABLE ingredients ADD COLUMN emoji TEXT NOT NULL DEFAULT '';");
    const rows = db.prepare('SELECT id, name, category FROM ingredients').all() as unknown as { id: number; name: string; category: Category }[];
    const update = db.prepare('UPDATE ingredients SET emoji = ? WHERE id = ?');
    for (const row of rows) update.run(ingredientEmoji(row.name, row.category), row.id);
  },
  // 9 — notification history is account-scoped and independent of job retention.
  `CREATE TABLE notifications (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     message TEXT NOT NULL,
     level TEXT NOT NULL CHECK (level IN ('success', 'error')),
     action TEXT,
     event_id TEXT,
     created_at TEXT NOT NULL,
     read_at TEXT
   );
   CREATE UNIQUE INDEX notifications_event ON notifications (user_id, event_id);
   CREATE INDEX notifications_user ON notifications (user_id, id);
   CREATE INDEX notifications_unread ON notifications (user_id, id) WHERE read_at IS NULL;`,
  // 10 — accounts can also sign in with Google, and pick ChatGPT or another AI for scans and recipes
  //      ('' = automatic). The extra identities reuse user_identities.
  `ALTER TABLE users ADD COLUMN ai_provider TEXT NOT NULL DEFAULT '';`,
  // 11 — DeepSeek replaced Mistral as the alternative to a ChatGPT plan.
  `UPDATE users SET ai_provider = 'deepseek' WHERE ai_provider = 'mistral';`,
  // 12 — AI requests per person per UTC day, for the daily limit.
  `CREATE TABLE ai_usage (
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     day     TEXT NOT NULL,
     count   INTEGER NOT NULL,
     PRIMARY KEY (user_id, day)
   );`,
  // 13 — remove the old default that required a machine even in kitchens without one.
  // Match the exact shipped text; preserve personally edited dish descriptions.
  (db) => {
    const clean = (data: string): string => {
      const profile = JSON.parse(data) as KitchenProfile;
      if (!profile.dishTypes?.some((dish) => dish.name === 'Ice cream' && dish.details === 'Frozen dessert made in the ice-cream machine')) return data;
      return JSON.stringify({ ...profile, dishTypes: profile.dishTypes.map((dish) =>
        dish.name === 'Ice cream' && dish.details === 'Frozen dessert made in the ice-cream machine'
          ? { ...dish, details: 'Frozen desserts, including ice cream and sorbet' } : dish) });
    };
    const rows = db.prepare('SELECT user_id, data FROM kitchen_profiles').all() as unknown as { user_id: number; data: string }[];
    const update = db.prepare('UPDATE kitchen_profiles SET data = ? WHERE user_id = ?');
    for (const row of rows) {
      const data = clean(row.data);
      if (data !== row.data) update.run(data, row.user_id);
    }
    const old = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_profile'").get() as { value: string } | undefined;
    if (old) {
      const data = clean(old.value);
      if (data !== old.value) db.prepare("UPDATE settings SET value = ? WHERE key = 'kitchen_profile'").run(data);
    }
  },
  // 14 — what Scoop learned from feedback after cooking, fed into later recipe ideas.
  `CREATE TABLE scoop_memories (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     note         TEXT NOT NULL,
     recipe_title TEXT NOT NULL DEFAULT '',
     created_at   TEXT NOT NULL
   );
   CREATE INDEX scoop_memories_user ON scoop_memories (user_id, id);`,
  // 15 — shopping list: items added by hand, and items the cook said they don't need.
  //      A hidden pantry item comes back once it has been restocked and runs out again.
  `CREATE TABLE shopping_items (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     name            TEXT NOT NULL,
     normalized_name TEXT NOT NULL,
     emoji           TEXT NOT NULL,
     created_at      TEXT NOT NULL,
     UNIQUE (user_id, normalized_name)
   );
   CREATE TABLE shopping_hidden (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     item_key      TEXT NOT NULL,
     ingredient_id INTEGER REFERENCES ingredients (id) ON DELETE CASCADE,
     recipe_ids    TEXT NOT NULL DEFAULT '[]',
     created_at    TEXT NOT NULL,
     UNIQUE (user_id, item_key)
   );
   CREATE INDEX shopping_hidden_ingredient ON shopping_hidden (ingredient_id);
   CREATE TRIGGER shopping_hidden_restocked AFTER UPDATE OF in_stock ON ingredients WHEN NEW.in_stock = 1
   BEGIN
     DELETE FROM shopping_hidden WHERE ingredient_id = NEW.id;
   END;`,
  // 16 — cooking log: each time the cook says they made a recipe, with the recipe as cooked.
  `CREATE TABLE cooked_meals (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     title      TEXT NOT NULL,
     data       TEXT NOT NULL,
     cooked_at  TEXT NOT NULL
   );
   CREATE INDEX cooked_meals_user ON cooked_meals (user_id, id);`,
];

interface LegacyProfile {
  machineName: string;
  bowlCapacityMl: number;
  targetMixMinMl: number;
  targetMixMaxMl: number;
  churnMinutesMin: number;
  churnMinutesMax: number;
  freezerTempC: number;
  units: string;
  language: string;
  preferences: string;
}

interface LegacyRecipe {
  mixVolumeMl: number;
  churnMinutes: number;
  textureTips: string[];
  [key: string]: unknown;
}

/** v1 profiles described one ice-cream machine; keep those numbers as that appliance's details. */
export function upgradeIceCreamProfile(old: LegacyProfile): KitchenProfile {
  const machine: Appliance = {
    name: `${old.machineName} ice-cream machine`,
    details:
      `${old.bowlCapacityMl} ml bowl. Total mix before churning must be ${old.targetMixMinMl}–${old.targetMixMaxMl} ml. ` +
      `Churn ${old.churnMinutesMin}–${old.churnMinutesMax} min.`,
  };
  const freezer: Appliance = { name: 'Freezer', details: `Around ${old.freezerTempC} ºC: plan for scoopability of frozen desserts.` };
  const others = DEFAULT_PROFILE.appliances.filter((a) => !/ice-cream machine|freezer/i.test(a.name));
  return {
    appliances: [machine, freezer, ...others],
    dishTypes: DEFAULT_PROFILE.dishTypes,
    servings: DEFAULT_PROFILE.servings,
    units: old.units,
    language: old.language,
    preferences: old.preferences,
  };
}

export function upgradeIceCreamRecipe(old: LegacyRecipe): Record<string, unknown> {
  const { mixVolumeMl, churnMinutes, textureTips, ...rest } = old;
  return {
    ...rest,
    kind: 'ice-cream',
    makes: `~${mixVolumeMl} ml mix`,
    totalMinutes: churnMinutes,
    equipment: ['Ice-cream machine'],
    tips: textureTips,
  };
}
