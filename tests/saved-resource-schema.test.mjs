import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { saveResource, removeSavedResource } from '../functions/_lib/domain/saved-resources.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_init.sql', 'candidates/saved_resources.sql']) {
    db.exec(readFileSync(new URL('../schema/' + file, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO caregiver (id, first_name) VALUES ('cg_a', 'Fictional A'), ('cg_b', 'Fictional B');
    INSERT INTO saved_resource_catalog (resource_id, published) VALUES ('example-guide', 1);
  `);
  return db;
}

const save = `INSERT INTO saved_resource (caregiver_id, resource_id) VALUES (?, ?)
              ON CONFLICT (caregiver_id, resource_id) DO NOTHING`;

test('each owner can save the same resource and repeat a save without replacing its receipt', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  insert.run('cg_a', 'example-guide');
  const first = db.prepare('SELECT * FROM saved_resource WHERE caregiver_id = ?').get('cg_a');
  assert.equal(insert.run('cg_a', 'example-guide').changes, 0);
  assert.equal(insert.run('cg_b', 'example-guide').changes, 1);
  assert.deepEqual(db.prepare('SELECT * FROM saved_resource WHERE caregiver_id = ?').get('cg_a'), first);
  db.prepare('DELETE FROM saved_resource WHERE caregiver_id = ? AND resource_id = ?').run('cg_b', 'example-guide');
  assert.deepEqual(db.prepare('SELECT * FROM saved_resource').all(), [first]);
});

test('retiring a resource blocks new saves and preserves removal of an existing bookmark', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  insert.run('cg_a', 'example-guide');
  db.exec("UPDATE saved_resource_catalog SET published = 0 WHERE resource_id = 'example-guide'");
  for (const owner of ['cg_a', 'cg_b']) {
    assert.throws(() => insert.run(owner, 'example-guide'), /saved resource unavailable/);
  }
  assert.equal(db.prepare('DELETE FROM saved_resource WHERE caregiver_id = ? AND resource_id = ?').run('cg_a', 'example-guide').changes, 1);
  assert.equal(db.prepare('SELECT published FROM saved_resource_catalog').get().published, 0);
});

test('insertion requires a current caregiver and published resource, and saved rows cannot be reassigned', t => {
  const db = setup(t);
  const insert = db.prepare(save);
  db.exec("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_b'");
  db.exec("INSERT INTO saved_resource_catalog (resource_id) VALUES ('unpublished-guide')");
  for (const [owner, resource] of [
    ['cg_b', 'example-guide'], ['absent', 'example-guide'],
    ['cg_a', 'unpublished-guide'], ['cg_a', 'missing-guide'],
  ]) {
    assert.throws(() => insert.run(owner, resource), /saved resource unavailable/);
  }
  insert.run('cg_a', 'example-guide');
  assert.throws(() => db.exec("UPDATE saved_resource SET caregiver_id = 'cg_b'"), /immutable/);
});

function atomicStore(sqlite) {
  return {
    prepare(sql) {
      return { bind: (...values) => ({ sql, values }) };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(({ sql, values }) => {
          const bindings = Object.fromEntries(values.map((value, i) => ['?' + (i + 1), value]));
          return { results: sqlite.prepare(sql).all(bindings) };
        });
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('store returns the original save receipt and removes only the verified owner’s bookmark', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  const other = { ...owner, caregiverId: 'cg_b' };
  const receipt = await saveResource(db, owner, 'example-guide');
  assert.equal(receipt.status, 'saved');
  assert.ok(receipt.createdAt);
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), receipt);
  assert.deepEqual(await removeSavedResource(db, other, 'example-guide'), { status: 'removed' });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 1);
  sqlite.exec('UPDATE saved_resource_catalog SET published = 0');
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), { status: 'unavailable' });
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await removeSavedResource(db, owner, 'example-guide'), { status: 'removed' });
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 0);
});

test('store checks session expiry and current caregiver eligibility within the write batch', async t => {
  const sqlite = setup(t);
  const db = atomicStore(sqlite);
  const owner = { caregiverId: 'cg_a', expiresAtMs: Date.now() + 60000 };
  await saveResource(db, owner, 'example-guide');
  const expired = { ...owner, expiresAtMs: Date.now() - 1 };
  for (const operation of [saveResource, removeSavedResource]) {
    assert.deepEqual(await operation(db, expired, 'example-guide'), { status: 'unauthorized' });
  }
  sqlite.exec("UPDATE caregiver SET status = 'archived' WHERE id = 'cg_a'");
  assert.deepEqual(await removeSavedResource(db, owner, 'example-guide'), { status: 'unauthorized' });
  assert.deepEqual(await saveResource(db, owner, 'example-guide'), { status: 'unauthorized' });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM saved_resource').get().n, 1);
});
