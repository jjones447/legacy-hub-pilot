// [pc2-codex-13] D9 source qualification only: virtual snapshot files and
// in-memory SQLite. No CLI, workerd, provider, disk write or actual restore.
// Equality to a supplied snapshot does not authenticate its original provenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/restore-from-backup.mjs', import.meta.url), 'utf8');
const start = source.indexOf('export const PROTECTED_DATABASE_ID');
const end = source.indexOf('// CLI entry point', start);
assert.ok(start > 0 && end > start, 'qualified restore module boundaries');
const moduleBody = source.slice(start, end).replace(/^export /gm, '');
const schemaFiles = ['0001_init.sql', '0003_grant_award.sql'];
const schemas = new Map(schemaFiles.map(name => [name,
  readFileSync(new URL('../schema/' + name, import.meta.url), 'utf8')]));
const original = [
  { id: 29, actor: 'synthetic_staff', action: 'original.action', entity: 'synthetic',
    entity_id: "syn_O'Example", before_json: null,
    after_json: '{\n  "detail": "two   spaces\\tUnicode café 漢字",\n  "original": true\n}',
    at: '2000-01-02T03:04:05.678Z' },
  { id: 7, actor: 'synthetic_agent', action: 'prior.action', entity: 'synthetic',
    entity_id: null, before_json: '{"detail":"CRLF\\r\\nTab\\t"}',
    after_json: null, at: '2000-01-01T00:00:00Z' }
];
const sorted = rows => rows.map(row => ({ ...row })).sort((a, b) => a.id - b.id);

async function restoreFixture(rows, batchSize = 25, alterRead = value => value) {
  const root = resolve('/synthetic-audit-no-filesystem');
  const dumpDir = join(root, 'dump'), schemaDir = join(root, 'schema');
  const tables = { caregiver: [], event: [], registration: [], grant_application: [],
    award: [], followup: [], note: [], content_type: [], content_item: [], audit_log: rows };
  const manifest = { tables: Object.fromEntries(Object.entries(tables).map(([name, values]) => [name, values.length])) };
  const files = new Map([[join(dumpDir, 'manifest.json'), JSON.stringify(manifest)],
    ...Object.entries(tables).map(([name, values]) => [join(dumpDir, name + '.json'), JSON.stringify(values)]),
    ...schemaFiles.map(name => [join(schemaDir, name), schemas.get(name)])]);
  const forbiddenCalls = [];
  const forbidden = kind => (...args) => {
    forbiddenCalls.push([kind, ...args]);
    throw new Error('FORBIDDEN_' + kind);
  };
  const sandbox = {
    ROOT_DIR: root, resolve, join, process: { env: {} },
    existsSync: path => files.has(path),
    readFileSync(path) { assert.ok(files.has(path), 'only virtual fixture input'); return files.get(path); },
    readdirSync(path) { assert.equal(path, schemaDir); return schemaFiles; },
    writeFileSync: forbidden('DISK_WRITE'), unlinkSync: forbidden('DISK_DELETE'),
    execSync: forbidden('CHILD_PROCESS'), execFileSync: forbidden('CHILD_PROCESS'),
    console: { log() {}, error() {} }
  };
  const restore = vm.runInNewContext(moduleBody + '\nrestoreDatabase;', sandbox, { timeout: 1000 });
  const database = new DatabaseSync(':memory:');
  const restoreDb = {
    exec: sql => database.exec(sql),
    prepare(sql) {
      const stmt = database.prepare(sql);
      return {
        get: () => stmt.get(),
        all: () => sql.startsWith('SELECT * FROM "audit_log" ORDER BY id')
          ? alterRead(stmt.all()) : stmt.all()
      };
    }
  };
  try {
    const result = await restore({ dumpDir, schemaDir, targetDatabase: 'legacy-hub-audit-synthetic',
      db: restoreDb, batchSize, execFn: forbidden('CLI'), execFileFn: forbidden('CLI') });
    const restored = JSON.parse(JSON.stringify(database.prepare('SELECT * FROM audit_log ORDER BY id').all()));
    assert.deepEqual(forbiddenCalls, [], 'no CLI/provider/config/disk side effects');
    const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'audit_log_no_%' ORDER BY name").all();
    assert.deepEqual(triggers.map(row => row.name), ['audit_log_no_delete', 'audit_log_no_update']);
    if (rows.length) {
      assert.throws(() => database.exec('UPDATE audit_log SET actor=\'forbidden\''), /append-only/);
      assert.throws(() => database.exec('DELETE FROM audit_log'), /append-only/);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare('SELECT * FROM audit_log ORDER BY id').all())), restored);
    }
    return { result: JSON.parse(JSON.stringify(result)), restored };
  } finally { database.close(); }
}

for (const batchSize of [1, 25]) test('audit integrity: original IDs and every field survive synthetic direct restore batch ' + batchSize, async () => {
  const before = JSON.stringify(original);
  const { result, restored } = await restoreFixture(original, batchSize);
  assert.equal(result.success, true);
  assert.equal(result.verifiedCounts.audit_log, original.length);
  assert.equal(result.spotChecks.auditLogCount, original.length);
  assert.deepEqual(restored, sorted(original), 'exact ID/actor/action/entity/reference/JSON bytes/timestamps, not count alone');
  assert.equal(JSON.stringify(original), before, 'source fixture unchanged');
});

for (const [field, changed] of Object.entries({
  id: 30, actor: 'different_synthetic_actor', action: 'different.action', entity: 'different_entity',
  entity_id: 'different_reference', before_json: '{}', after_json: '{"original":false}',
  at: '2001-01-02T03:04:05.678Z'
})) test('restore itself rejects same-count target corruption in ' + field, async () => {
  await assert.rejects(restoreFixture(original, 25, rows => rows.map((row, index) =>
    index === 0 ? { ...row, [field]: changed } : row)), /Audit integrity mismatch/);
});

test('restore verifies more than one audit page and records explicit snapshot comparison', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ ...original[0], id: index + 1 }));
  const { result, restored } = await restoreFixture(rows.reverse());
  assert.deepEqual(restored, sorted(rows));
  assert.equal(result.auditVerification.verified, true);
  assert.equal(result.auditVerification.comparedRows, 205);
  assert.equal(result.auditVerification.basis, 'cached-backup-audit-rows');
});

test('restore rejects truncated audit query output despite matching COUNT', async () => {
  await assert.rejects(restoreFixture(original, 25, rows => rows.slice(0, 1)), /Audit integrity mismatch/);
});

test('audit integrity: explicitly empty snapshot has no fabricated original audit rows', async () => {
  const { result, restored } = await restoreFixture([]);
  assert.equal(result.verifiedCounts.audit_log, 0);
  assert.deepEqual(restored, []);
});

for (const [field, changed] of Object.entries({
  id: 30, actor: 'different_synthetic_actor', action: 'different.action', entity: 'different_entity',
  entity_id: 'different_reference', before_json: '{}', after_json: '{"original":false}',
  at: '2001-01-02T03:04:05.678Z'
})) test('audit integrity: same-count altered ' + field + ' is caught by exact-row oracle', async () => {
  const altered = original.map((row, index) => index === 0 ? { ...row, [field]: changed } : { ...row });
  const { result, restored } = await restoreFixture(altered);
  // Even an exact restore comparison cannot authenticate an already changed
  // backup. Installed acceptance still needs a trusted original snapshot.
  assert.equal(result.success, true);
  assert.equal(result.verifiedCounts.audit_log, original.length);
  assert.equal(result.spotChecks.auditLogPreserved, true);
  assert.throws(() => assert.deepEqual(restored, sorted(original)), assert.AssertionError);
});
