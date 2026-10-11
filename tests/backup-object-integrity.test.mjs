// Isolated synthetic unit tests only: no SQLite, filesystem writes, subprocesses,
// network, Wrangler, workerd, live bindings, backup invocation or restore CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import backupWorker, { runBackup, describeBackupBytes } from '../workers/backup/src/index.mjs';

function fixture({ rows = { synthetic_table: [{ id: 'fixture-1', text: 'café ☃' }] },
  completed = false, headFailure = false, putFailure = false } = {}) {
  const calls = { reads: [], puts: [], lists: [], deletes: [] };
  const store = new Map();
  const env = {
    DB: {
      prepare(sql) {
        calls.reads.push(sql);
        return {
          async all() {
            if (sql.includes('sqlite_master')) return { results: Object.keys(rows).map(name => ({ name })) };
            const table = /^SELECT \* FROM "([^"]+)"$/.exec(sql)?.[1];
            assert.ok(Object.hasOwn(rows, table), 'synthetic table only');
            return { results: rows[table] };
          },
          async first() { return { name: '0012_wellness_checkin.sql' }; }
        };
      }
    },
    BACKUPS: {
      async head() { if (headFailure) throw new Error('synthetic head failure'); return completed ? { key: 'manifest' } : null; },
      async put(key, value, options) {
        calls.puts.push({ key, value, options });
        if (putFailure) throw new Error('synthetic put failure');
        store.set(key, value);
        return { key };
      },
      async list(options) { calls.lists.push(options); return { objects: [], truncated: false }; },
      async delete(key) { calls.deletes.push(key); }
    }
  };
  return { env, calls, store, options: { now: '2026-10-12T03:00:00Z' } };
}

test('exact uploaded UTF-8 bytes have independently computed SHA-256 and byte length', async () => {
  const f = fixture();
  const result = await runBackup(f.env, f.options);
  const uploadedText = f.store.get(`${result.prefix}/synthetic_table.json`);
  assert.equal(typeof uploadedText, 'string');
  const uploaded = new TextEncoder().encode(uploadedText);
  const expectedText = JSON.stringify([{ id: 'fixture-1', text: 'café ☃' }], null, 2);
  assert.equal(new TextDecoder().decode(uploaded), expectedText);
  assert.ok(uploaded.byteLength > expectedText.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result.manifest.integrity)), {
    algorithm: 'SHA-256', encoding: 'utf-8', tables: {
      synthetic_table: { key: `${result.prefix}/synthetic_table.json`, byte_length: uploaded.byteLength,
        sha256: createHash('sha256').update(uploaded).digest('hex') }
    }
  });
  const manifest = JSON.parse(f.store.get(`${result.prefix}/manifest.json`));
  assert.deepEqual(manifest.integrity, JSON.parse(JSON.stringify(result.manifest.integrity)));
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.tables, { synthetic_table: 1 });
  assert.equal(manifest.total_rows, 1);
  assert.equal(manifest.latest_migration, '0012_wellness_checkin.sql');
  assert.equal(f.calls.puts.at(-1).key, `${result.prefix}/manifest.json`);
});

test('empty table digest covers the literal uploaded [] bytes', async () => {
  const f = fixture({ rows: { empty_table: [] } });
  const result = await runBackup(f.env, f.options);
  assert.equal(result.manifest.integrity.tables.empty_table.byte_length, 2);
  assert.equal(result.manifest.integrity.tables.empty_table.sha256,
    createHash('sha256').update('[]').digest('hex'));
  assert.equal(result.totalRows, 0);
});

test('each table has its own bytes, key and digest without changing table counts', async () => {
  const f = fixture({ rows: { first: [{ id: 1 }], second: [{ id: 2 }, { id: 3 }] } });
  const result = await runBackup(f.env, f.options);
  assert.deepEqual(result.manifest.tables, { first: 1, second: 2 });
  assert.equal(result.totalRows, 3);
  for (const [table, reference] of Object.entries(result.manifest.integrity.tables)) {
    assert.equal(reference.key, `${result.prefix}/${table}.json`);
    assert.equal(reference.sha256, createHash('sha256').update(f.store.get(reference.key)).digest('hex'));
  }
});

test('digest helper has known SHA-256 vectors and distinguishes one-byte corruption', async () => {
  const empty = await describeBackupBytes(new Uint8Array());
  assert.equal(empty.byte_length, 0);
  assert.equal(empty.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const abc = await describeBackupBytes(new TextEncoder().encode('abc'));
  assert.equal(abc.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(abc.sha256, (await describeBackupBytes(new TextEncoder().encode('abd'))).sha256);
});

test('hashing failure produces no table upload, completion marker or pruning', async (t) => {
  t.mock.method(crypto.subtle, 'digest', async () => { throw new Error('synthetic digest failure'); });
  const f = fixture();
  await assert.rejects(runBackup(f.env, f.options), /synthetic digest failure/);
  assert.equal(f.calls.puts.length, 0);
  assert.equal(f.calls.lists.length, 0);
  assert.equal(f.calls.deletes.length, 0);
});

test('upload failure cannot publish integrity completion metadata or prune', async () => {
  const f = fixture({ putFailure: true });
  await assert.rejects(runBackup(f.env, f.options), /synthetic put failure/);
  assert.equal(f.calls.puts.length, 1);
  assert.ok(!f.calls.puts[0].key.endsWith('/manifest.json'));
  assert.equal(f.calls.lists.length, 0);
});

for (const [name, options, pattern] of [
  ['existing completion', { completed: true }, /completed backup already exists/],
  ['head failure', { headFailure: true }, /synthetic head failure/]
]) {
  test(`${name} refuses before database reads, digest/upload or pruning`, async () => {
    const f = fixture(options);
    await assert.rejects(runBackup(f.env, f.options), pattern);
    assert.deepEqual(f.calls, { reads: [], puts: [], lists: [], deletes: [] });
  });
}

test('public fetch remains 404 without touching bindings', async () => {
  const response = await backupWorker.fetch(new Request('https://synthetic.invalid/'), {});
  assert.equal(response.status, 404);
});
