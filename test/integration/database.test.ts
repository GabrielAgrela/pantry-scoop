import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { assertRecipe } from '../../src/domain/recipe.ts';
import { DEFAULT_PROFILE, LEGACY_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { MIGRATIONS } from '../../src/infrastructure/db/migrations.ts';
import { hostIdentity } from '../../src/infrastructure/db/sqlite-account-repositories.ts';
import { SqliteIngredientRepository } from '../../src/infrastructure/db/sqlite-ingredient-repository.ts';
import { SqliteProfileRepository } from '../../src/infrastructure/db/sqlite-profile-repository.ts';
import { SqliteSavedRecipeRepository } from '../../src/infrastructure/db/sqlite-saved-recipe-repository.ts';
import { accountRepos, identity, PLAN_SCOPES } from '../fakes/fixtures.ts';

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'pantry-db-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const natas = { name: 'Natas', category: 'dairy' as const, notes: '', source: 'manual' as const };

describe('openDatabase', () => {
  it('cleans only the inherited machine-specific dish default and preserves custom profiles and recipes', () => {
    withTempDir((dir) => {
      const path = join(dir, 'before-equipment-fix.db');
      const old = new DatabaseSync(path);
      for (const migration of MIGRATIONS.slice(0, 12)) {
        if (typeof migration === 'string') old.exec(migration);
        else migration(old);
      }
      old.exec('PRAGMA user_version = 12;');
      const users = accountRepos(old).users;
      const inherited = users.create(identity('inherited'));
      const custom = users.create(identity('custom'));
      const { pantryBasics: _unused, ...defaults } = DEFAULT_PROFILE;
      const profile = { ...defaults, dishTypes: LEGACY_PROFILE.dishTypes, preferences: 'Keep this', setupComplete: true };
      new SqliteProfileRepository(old, inherited.id).save(profile);
      const edited = { ...profile, dishTypes: [{ name: 'Ice cream', details: 'Use my special machine for family recipes' }] };
      new SqliteProfileRepository(old, custom.id).save(edited);
      old.prepare("INSERT INTO settings (key, value) VALUES ('kitchen_profile', ?)").run(JSON.stringify(profile));
      old.prepare('INSERT INTO saved_recipes (data, created_at, user_id) VALUES (?, ?, ?)').run('{"keep":"original"}', 'x', inherited.id);
      old.close();
      const migrated = openDatabase(path);
      const updated = new SqliteProfileRepository(migrated, inherited.id).load()!;
      assert.deepEqual(updated, { ...profile, dishTypes: DEFAULT_PROFILE.dishTypes });
      assert.deepEqual(new SqliteProfileRepository(migrated, custom.id).load(), edited);
      const legacy = migrated.prepare("SELECT value FROM settings WHERE key = 'kitchen_profile'").get() as { value: string };
      assert.deepEqual(JSON.parse(legacy.value), updated);
      assert.equal(migrated.prepare('SELECT data FROM saved_recipes').get()!.data, '{"keep":"original"}');
      migrated.close();
      const reopened = openDatabase(path);
      assert.deepEqual(new SqliteProfileRepository(reopened, inherited.id).load(), updated);
      reopened.close();
    });
  });

  it('backfills emojis for every existing owner and stock state without changing ingredient data', () => {
    withTempDir((dir) => {
      const path = join(dir, 'before-emojis.db');
      const old = new DatabaseSync(path);
      for (const migration of MIGRATIONS.slice(0, 7)) {
        if (typeof migration === 'string') old.exec(migration);
        else migration(old);
      }
      old.exec('PRAGMA user_version = 7;');
      const users = accountRepos(old).users;
      const alice = users.create(identity('emoji-alice'));
      const bob = users.create(identity('emoji-bob'));
      const insert = old.prepare('INSERT INTO ingredients (user_id, name, normalized_name, category, notes, source, in_stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      insert.run(alice.id, 'Cherry tomatoes', 'cherry tomatoes', 'vegetables', 'Half a punnet', 'photo', 1, '2026-09-01');
      insert.run(bob.id, 'Leite magro', 'leite magro', 'dairy', 'Keep chilled', 'manual', 0, '2026-09-02');
      insert.run(null, 'Arroz', 'arroz', 'other', '', 'manual', 1, '2026-09-03');
      const before = old.prepare('SELECT * FROM ingredients ORDER BY id').all().map((row) => ({ ...row }));
      old.close();

      const migrated = openDatabase(path);
      const rows = migrated.prepare('SELECT * FROM ingredients ORDER BY id').all();
      assert.deepEqual(rows.map(({ emoji, ...rest }) => rest), before);
      assert.deepEqual(rows.map((row) => row.emoji), ['🍅', '🥛', '🍚']);
      assert.equal(new SqliteIngredientRepository(migrated, alice.id).list().length, 1);
      assert.equal(new SqliteIngredientRepository(migrated, bob.id).list()[0]!.inStock, false);
      migrated.close();

      const reopened = openDatabase(path);
      assert.deepEqual(reopened.prepare('SELECT * FROM ingredients ORDER BY id').all(), rows);
      reopened.close();
    });
  });

  it('creates the file, migrates to the latest version and keeps data across reopen', () => {
    withTempDir((dir) => {
      const path = join(dir, 'nested', 'pantry.db');
      const first = openDatabase(path);
      const user = accountRepos(first).users.create(identity());
      new SqliteIngredientRepository(first, user.id).insert(natas);
      first.close();

      const second = openDatabase(path);
      const version = second.prepare('PRAGMA user_version').get() as { user_version: number };
      assert.equal(version.user_version, MIGRATIONS.length);
      assert.deepEqual(new SqliteIngredientRepository(second, user.id).list().map((i) => i.name), ['Natas']);
      second.close();
    });
  });

  it('upgrades a v1 (ice-cream only) database and hands its data to the first account', () => {
    withTempDir((dir) => {
      const path = join(dir, 'v1.db');
      const v1 = new DatabaseSync(path);
      v1.exec(MIGRATIONS[0] as string);
      v1.exec(`PRAGMA user_version = 1;
        INSERT INTO ingredients (name, normalized_name, category, notes, source, created_at) VALUES
          ('Goma xantana', 'goma xantana', 'thickener', '', 'photo', 'x'),
          ('Palitos', 'palitos', 'biscuits', '', 'photo', 'x'),
          ('Natas', 'natas', 'dairy', '', 'photo', 'x');`);
      v1.prepare("INSERT INTO settings (key, value) VALUES ('kitchen_profile', ?)").run(JSON.stringify({
        machineName: 'Gelacy 1200', bowlCapacityMl: 1200, targetMixMinMl: 700, targetMixMaxMl: 850,
        churnMinutesMin: 30, churnMinutesMax: 40, freezerTempC: -18, units: 'ml', language: 'PT', preferences: 'no yogurt',
      }));
      v1.prepare('INSERT INTO saved_recipes (data, created_at) VALUES (?, ?)').run(JSON.stringify({
        title: 'Mango', summary: 's', mixVolumeMl: 760, churnMinutes: 35,
        ingredients: [{ name: 'Manga', amount: '300 ml', inStock: true }], steps: ['Churn'], textureTips: ['Vodka'],
        estimate: { kcalMin: 1, kcalMax: 2, sugarGramsMin: 3, sugarGramsMax: 4 },
      }), 'x');
      v1.close();

      const db = openDatabase(path);
      const { users, unownedData } = accountRepos(db);
      const owner = users.create(identity('owner'));
      assert.deepEqual(new SqliteIngredientRepository(db, owner.id).list(), [], 'unclaimed data is invisible');
      unownedData.claimUnowned(owner.id);

      const ingredients = new SqliteIngredientRepository(db, owner.id).list();
      assert.ok(ingredients.every((i) => i.inStock), 'existing items start in stock');
      assert.deepEqual(ingredients.map((i) => [i.name, i.category]).sort(), [['Goma xantana', 'baking'], ['Natas', 'dairy'], ['Palitos', 'snacks']]);

      const profile = new SqliteProfileRepository(db, owner.id).load()!;
      assert.equal(profile.preferences, 'no yogurt');
      assert.match(profile.appliances[0]!.details, /700–850 ml.*30–40 min/);
      assert.match(profile.appliances[1]!.details, /-18 ºC/);

      const [saved] = new SqliteSavedRecipeRepository(db, owner.id).list();
      const recipe = assertRecipe(saved!.recipe);
      assert.equal(recipe.kind, 'ice-cream');
      assert.equal(recipe.makes, '~760 ml mix');
      assert.deepEqual(recipe.tips, ['Vodka']);

      const second = users.create(identity('second'));
      unownedData.claimUnowned(second.id);
      assert.deepEqual(new SqliteIngredientRepository(db, second.id).list(), [], 'nothing left to claim');
      db.close();
    });
  });
});

describe('per-user data', () => {
  it('keeps each user’s stock, profile and recipes apart', () => {
    const db = openDatabase(':memory:');
    const { users } = accountRepos(db);
    const a = users.create(identity('a'));
    const b = users.create(identity('b'));
    const stockA = new SqliteIngredientRepository(db, a.id);
    const stockB = new SqliteIngredientRepository(db, b.id);

    const mine = stockA.insert(natas);
    stockB.insert(natas); // same name is fine for a different user
    assert.equal(stockB.findById(mine.id), undefined);
    assert.equal(stockB.delete(mine.id), false);
    assert.equal(stockA.list().length, 1);

    new SqliteProfileRepository(db, a.id).save({ appliances: [], dishTypes: [], servings: 4, units: 'g', language: 'EN', preferences: '' });
    assert.equal(new SqliteProfileRepository(db, b.id).load(), undefined);
  });
});

describe('account repositories', () => {
  it('encrypts tokens at rest and keeps the registration when tokens are cleared', () => {
    const db = openDatabase(':memory:');
    const { users, connections } = accountRepos(db);
    const user = users.create(identity());
    connections.save({
      userId: user.id,
      clientId: 'oaiapp_1',
      idToken: 'id-secret',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      scopes: PLAN_SCOPES,
      expiresAt: 123,
    });

    const raw = JSON.stringify(db.prepare('SELECT * FROM chatgpt_connections').all());
    assert.doesNotMatch(raw, /-secret/);
    assert.equal(connections.findByClientId('oaiapp_1')?.accessToken, 'access-secret');

    connections.clearTokens(user.id);
    const cleared = connections.find(user.id)!;
    assert.deepEqual(
      [cleared.clientId, cleared.idToken, cleared.accessToken, cleared.refreshToken, cleared.scopes],
      ['oaiapp_1', 'id-secret', '', '', []],
    );
  });

  it('expires sessions and counts only live ones', () => {
    const db = openDatabase(':memory:');
    const { users, sessions } = accountRepos(db);
    const user = users.create(identity());
    sessions.create(user.id, 'live', 2000);
    sessions.create(user.id, 'old', 500);
    assert.equal(sessions.findUserId('live', 1000), user.id);
    assert.equal(sessions.findUserId('old', 1000), undefined);
    assert.equal(sessions.countForUser(user.id, 1000), 1);
  });

  it('creates the host ID once', () => {
    const db = openDatabase(':memory:');
    const first = hostIdentity(db);
    assert.match(first, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(hostIdentity(db), first);
  });
});
