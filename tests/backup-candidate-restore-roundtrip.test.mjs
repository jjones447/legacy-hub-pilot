// [pc2-codex-41] Candidate223 -> existing strict restore, fictional data only.
// Node SQLite/in-memory R2 and owned temporary files; no CLI or cloud runtime.
// Supplied-manifest integrity is not authentication of a production artifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { runBackup } from '../workers/backup/candidates/pre-return-bounded.mjs';
import { restoreDatabase, buildInsertSql } from '../scripts/restore-from-backup.mjs';

const producerUrl = new URL('../workers/backup/candidates/pre-return-bounded.mjs', import.meta.url);
const producerHash = '0de296c5390b434b554199bab3a07b7324357bf93d3eb514162dc47f5e7e4d38';
const plain = value => JSON.parse(JSON.stringify(value));
const auditFields = ['id', 'actor', 'action', 'entity', 'entity_id', 'before_json', 'after_json', 'at'];
const originalAudit = [
  { id: 7, actor: 'fictional_staff', action: 'original.confirm', entity: 'note',
    entity_id: "fictional_O'Example", before_json: null,
    after_json: '{\n  "text": "café 漢字 🌎 and O\'Example",\n  "original": true\n}',
    at: '2000-01-01T00:00:00.000Z' },
  { id: 29, actor: 'fictional_agent', action: 'original.propose', entity: 'caregiver',
    entity_id: null, before_json: '{"detail":"CRLF\\r\\nTab\\t"}', after_json: null,
    at: '2000-01-02T03:04:05.678Z' }
];

test('restore SQL encodes NUL-bearing text without changing text type, suffix, quotes or ordinary literals', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE fictional(value TEXT);');
    const values = [null, '', "O'Example", 'café 漢字 🌎', '\u0000', 'prefix\u0000suffix',
      "\uFEFFO'Example\r\n\t\u0000漢字🌎\u0000tail"];
    const sql = buildInsertSql('fictional', values.map(value => ({ value })));
    assert.ok(!sql.includes('\u0000'), 'SQL source contains no literal NUL');
    assert.ok(sql.includes("'O''Example'"), 'ordinary quoted literals retain their existing form');
    database.exec(sql);
    assert.deepEqual(database.prepare('SELECT value FROM fictional ORDER BY rowid').all().map(row => row.value), values);
    assert.deepEqual(database.prepare('SELECT typeof(value) AS kind FROM fictional ORDER BY rowid').all().map(row => row.kind),
      ['null', ...values.slice(1).map(() => 'text')]);
  } finally { database.close(); }
});

// Same transactional node:sqlite adapter mechanism as the existing backup tests.
function d1Adapter(database) {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(({ sql }) => ({ success: true, results: database.prepare(sql).all() }));
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    }
  };
}

async function capture(t) {
  assert.equal(createHash('sha256').update(readFileSync(producerUrl)).digest('hex'), producerHash,
    'exercise the exact accepted candidate223 module, unchanged');
  const root = mkdtempSync(join(tmpdir(), 'legacy-candidate223-seam-'));
  const source = new DatabaseSync(':memory:');
  const target = new DatabaseSync(':memory:');
  t.after(() => {
    source.close(); target.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('legacy-candidate223-seam-'));
    rmSync(root, { recursive: true, force: true }); // Checked, exclusively owned test directory.
  });
  const schemaDir = join(root, 'schema'), dumpDir = join(root, 'dump');
  mkdirSync(schemaDir); mkdirSync(dumpDir);
  for (const name of ['0001_init.sql', '0003_grant_award.sql']) {
    const sql = readFileSync(new URL('../schema/' + name, import.meta.url), 'utf8');
    writeFileSync(join(schemaDir, name), sql);
    source.exec(sql);
  }
  // Remove the existing migration's seed so relationship checks need no unrelated schema.
  source.exec('DELETE FROM grant_application; DELETE FROM caregiver;');
  const scalarSchema = 'CREATE TABLE fixture_scalar(id INTEGER PRIMARY KEY, value TEXT, nullable TEXT, amount REAL, whole INTEGER);';
  writeFileSync(join(schemaDir, '0004_fictional_scalar.sql'), scalarSchema);
  source.exec(scalarSchema);
  const values = [Math.PI, 1.0000000000000002, Number.MIN_VALUE, -123.45678901234567];
  for (const [index, amount] of values.entries()) {
    source.prepare('INSERT INTO fixture_scalar VALUES(?,?,?,?,?)').run(index + 1,
      '\uFEFFcafé 漢字 🌎 O\'Example\r\n\t' + (index === 0 ? '\u0000tail' : '001.20'),
      null, amount, index === 0 ? Number.MAX_SAFE_INTEGER : -index);
  }
  for (const row of originalAudit) {
    source.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?,?,?)').run(...auditFields.map(field => row[field]));
  }
  const names = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const originals = new Map(names.map(name => [name, plain(source.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));
  const objects = new Map();
  const backup = await runBackup({ DB: d1Adapter(source), BACKUPS: {
    async head(key) { return objects.has(key) ? {} : null; },
    async put(key, payload) {
      assert.equal(typeof payload, 'string');
      assert.ok(!objects.has(key));
      objects.set(key, Buffer.from(payload, 'utf8')); // Exact producer PUT bytes, never reserialized rows.
    },
    async list() { return { objects: [], truncated: false }; },
    async delete() { assert.fail('fictional fixture has nothing to prune'); }
  } }, { now: new Date('2000-01-03T03:00:00.000Z') });
  assert.equal(backup.success, true);
  assert.equal(objects.size, names.length + 1);
  assert.equal([...objects.keys()].at(-1), backup.prefix + '/manifest.json');
  for (const [key, bytes] of objects) writeFileSync(join(dumpDir, basename(key)), bytes);
  const manifest = JSON.parse(readFileSync(join(dumpDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, plain(backup.manifest));
  target.exec("CREATE TABLE untouched(value TEXT); INSERT INTO untouched VALUES('keep-before-preflight');");
  const calls = [];
  const restore = async (alterAudit = rows => rows) => restoreDatabase({
    dumpDir, schemaDir, targetDatabase: 'legacy-candidate223-fictional', requireIntegrity: true,
    db: {
      exec(sql) { calls.push(sql); return target.exec(sql); },
      prepare(sql) {
        calls.push(sql);
        const statement = target.prepare(sql);
        return {
          get: () => statement.get(),
          all: () => sql.startsWith('SELECT * FROM "audit_log" ORDER BY id')
            ? alterAudit(statement.all()) : statement.all()
        };
      }
    },
    execFn() { assert.fail('CLI forbidden'); }, execFileFn() { assert.fail('CLI forbidden'); }
  });
  return { dumpDir, target, objects, originals, manifest, restore, calls };
}

test('candidate223 exact PUT bytes -> strict restore preserves every table and all eight original audit fields', async t => {
  const f = await capture(t);
  const result = await f.restore();
  assert.equal(result.success, true);
  assert.equal(result.integrityVerification.verified, true);
  assert.equal(result.integrityVerification.tableCount, f.originals.size);
  assert.deepEqual(result.auditVerification,
    { verified: true, comparedRows: 2, basis: 'cached-backup-audit-rows' });
  assert.equal(result.spotChecks.auditLogPreserved, true);
  assert.equal(result.verifiedCounts.event, 0, 'zero-count tables travel through both components');
  for (const [name, rows] of f.originals) {
    assert.deepEqual(plain(f.target.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()), rows, name);
  }
  assert.deepEqual(plain(f.target.prepare('SELECT * FROM audit_log ORDER BY id').all()), originalAudit);
  assert.equal(Object.keys(originalAudit[0]).length, 8);
  assert.throws(() => f.target.exec("UPDATE audit_log SET actor='forbidden'"), /append-only/);
  assert.throws(() => f.target.exec('DELETE FROM audit_log'), /append-only/);
});

test('candidate223 damaged bytes, missing zero table, count mismatch and absent integrity refuse before any target call', async t => {
  const f = await capture(t);
  const manifestPath = join(f.dumpDir, 'manifest.json');
  const mutations = [
    { apply() { writeFileSync(join(f.dumpDir, 'audit_log.json'), Buffer.concat([
      f.objects.get('legacy-hub/2000-01-03/audit_log.json'), Buffer.from(' ')])); }, pattern: /bytes do not match/ },
    { apply() { rmSync(join(f.dumpDir, 'event.json')); }, pattern: /required backup table file is missing/ },
    { apply() { const m = structuredClone(f.manifest); m.tables.audit_log++; writeFileSync(manifestPath, JSON.stringify(m)); }, pattern: /matching the declared count/ },
    { apply() { const m = structuredClone(f.manifest); delete m.integrity; writeFileSync(manifestPath, JSON.stringify(m)); }, pattern: /integrity metadata is required/ }
  ];
  for (const { apply, pattern } of mutations) {
    for (const [key, bytes] of f.objects) writeFileSync(join(f.dumpDir, basename(key)), bytes);
    apply();
    await assert.rejects(f.restore(), pattern);
    assert.deepEqual(f.calls, [], 'all input checks precede even the first target prepare/exec');
    assert.equal(f.target.prepare('SELECT value FROM untouched').get().value, 'keep-before-preflight');
  }
});

test('candidate223 roundtrip refuses same-count target audit corruption in each original field before returning success', async t => {
  const f = await capture(t);
  const changed = { id: 8, actor: 'changed', action: 'changed', entity: 'changed', entity_id: 'changed',
    before_json: '{}', after_json: '{}', at: '2001-01-01T00:00:00Z' };
  for (const [field, value] of Object.entries(changed)) {
    await assert.rejects(f.restore(rows => rows.map((row, index) => index === 0 ? { ...row, [field]: value } : row)),
      /Audit integrity mismatch/, field);
  }
});

test('candidate223 changed audit plus recomputed manifest cannot pass the separately supplied original-row oracle', async t => {
  const f = await capture(t);
  const rows = JSON.parse(readFileSync(join(f.dumpDir, 'audit_log.json'), 'utf8'));
  rows[0].actor = 'changed-despite-matching-count';
  const bytes = Buffer.from(JSON.stringify(rows));
  writeFileSync(join(f.dumpDir, 'audit_log.json'), bytes);
  const manifest = structuredClone(f.manifest);
  Object.assign(manifest.integrity.tables.audit_log, { byte_length: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  writeFileSync(join(f.dumpDir, 'manifest.json'), JSON.stringify(manifest));
  const result = await f.restore();
  // Consumer verifies the supplied snapshot; it cannot authenticate rewritten inputs.
  assert.equal(result.auditVerification.verified, true);
  assert.equal(result.verifiedCounts.audit_log, originalAudit.length);
  assert.throws(() => assert.deepEqual(plain(f.target.prepare('SELECT * FROM audit_log ORDER BY id').all()), originalAudit),
    assert.AssertionError, 'acceptance must compare the trusted originals, not counts or rewritten input');
});
