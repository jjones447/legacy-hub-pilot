// Tests for LEGACY-D9-BACKUPS-RESTORE-10A (Issue #104)
// Covers:
// 1. Live-DB refusal guard: 'legacy-hub-db' strictly refused
// 2. Scheduled backup Worker: discovery from sqlite_master (including schema 0008 agent_change), R2 upload
// 3. Retention pruning: exactly expired keys pruned, unexpired preserved
// 4. On-demand export (scripts/export-all.mjs): discovers tables, writes <table>.json + manifest.json
// 5. Round trip dump -> restore: schema recreated in order, identical counts, spot-checked relationships, audit_log preserved
// 6. Worker reveal-guard: no public HTTP routes (404)

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import backupWorker, { runBackup, pruneOldBackups, BAKED_IN_LATEST_MIGRATION } from '../workers/backup/src/index.mjs';
import { exportDatabase } from '../scripts/export-all.mjs';
import {
  restoreDatabase,
  checkTargetDatabase,
  spotCheckRelationships,
  resolveDatabaseId,
  createTempWranglerConfig,
  splitSqlStatements,
  chunkArray
} from '../scripts/restore-from-backup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const SCHEMAS_DIR = join(ROOT_DIR, 'schema');

const SCHEMA_FILES = [
  '0001_init.sql',
  '0002_seed_public_events.sql',
  '0003_grant_award.sql',
  '0004_content_types.sql',
  '0005_portal_login.sql',
  '0006_caregiver_contact_history_outcomes.sql',
  '0007_grant_course_complete.sql',
  '0008_agent_change.sql',
  '0009_content_live.sql',
  '0010_page_section_forms.sql',
  '0011_staff_member.sql',
  '0012_wellness_checkin.sql'
];

function createSeededDatabase() {
  const db = new DatabaseSync(':memory:');
  for (const sf of SCHEMA_FILES) {
    const sql = readFileSync(join(SCHEMAS_DIR, sf), 'utf8');
    db.exec(sql);
  }

  // Insert representative synthetic records across tables
  const cgId = 'cg_synthetic_1001';
  db.exec(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, preferred_contact, caring_for, relationship, segment_tags, status, outcome_status, outcome_notes, outcome_updated_at)
    VALUES ('${cgId}', 'Jane', 'Caregiver', 'jane@example.invalid', '555-0199', 'email', 'Mother with dementia', 'daughter', '["carer","respite_eligible"]', 'active', 'improving', 'Respite relief achieved', '2026-09-24 10:00:00');
  `);

  db.exec(`
    INSERT INTO grant_application (id, caregiver_id, status, requested_for, review_notes, source)
    VALUES (501, '${cgId}', 'closed', 'Day respite care', 'Approved for dementia training', 'staff');
  `);

  db.exec(`
    INSERT INTO award (id, grant_application_id, amount, care_package, outcome)
    VALUES (701, 501, '$500', 'Weekend Respite Package', 'Completed training, stress reduced');
  `);

  db.exec(`
    INSERT INTO followup (id, caregiver_id, kind, detail, status, source)
    VALUES (901, '${cgId}', 'wellness_check', 'Check-in on caregiver status', 'open', 'staff');
  `);

  db.exec(`
    INSERT INTO contact_history (caregiver_id, occurred_at, channel, direction, summary, recorded_by)
    VALUES ('${cgId}', '2026-09-20T10:00:00Z', 'phone', 'inbound', 'Inquiry about respite services', 'staff@example.test');
  `);

  db.exec(`
    INSERT INTO note (caregiver_id, author, body, visibility, status)
    VALUES ('${cgId}', 'staff@example.test', 'Caregiver attended orientation session', 'staff', 'active');
  `);

  db.exec(`
    INSERT INTO agent_change (id, area, operation, target_id, payload_json, status, requested_by)
    VALUES ('ac_001', 'caregiver', 'update', '${cgId}', '{"notes":"test"}', 'draft', 'dev-agent@example.test');
  `);

  db.exec(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('dev-tester@example.test', 'grant_application.close', 'grant_application', '501', '{"status":"course_complete"}', '{"status":"closed"}');
  `);

  return db;
}

class MockR2Bucket {
  constructor() {
    this.store = new Map();
  }

  async head(key) {
    if (!this.store.has(key)) return null;
    const item = this.store.get(key);
    return { key, size: Buffer.byteLength(item.value), httpMetadata: item.metadata.httpMetadata };
  }

  async put(key, value, options = {}) {
    this.store.set(key, { value: String(value), metadata: options });
    return { key };
  }

  async get(key) {
    if (!this.store.has(key)) return null;
    const item = this.store.get(key);
    return {
      key,
      text: async () => item.value,
      json: async () => JSON.parse(item.value)
    };
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list({ prefix = '', cursor } = {}) {
    const keys = Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();
    return {
      objects: keys.map((k) => ({ key: k })),
      truncated: false
    };
  }
}

function d1Adapter(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return db.prepare(sql).get(...params) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...params) };
            },
            async run() {
              const res = db.prepare(sql).run(...params);
              return { success: true, meta: { last_row_id: Number(res.lastInsertRowid) } };
            }
          };
        },
        async first() {
          return db.prepare(sql).get() ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all() };
        },
        async run() {
          const res = db.prepare(sql).run();
          return { success: true, meta: { last_row_id: Number(res.lastInsertRowid) } };
        }
      };
    }
  };
}

test('1. Live-DB refusal guard strictly refuses target "legacy-hub-db"', async () => {
  assert.throws(
    () => checkTargetDatabase('legacy-hub-db'),
    /REFUSAL: Target database cannot be the live database 'legacy-hub-db'/
  );
  assert.throws(
    () => checkTargetDatabase('LEGACY-HUB-DB'),
    /REFUSAL: Target database cannot be the live database 'legacy-hub-db'/
  );
  assert.throws(
    () => checkTargetDatabase('  legacy-hub-db  '),
    /REFUSAL: Target database cannot be the live database 'legacy-hub-db'/
  );

  // Rejection in restoreDatabase function
  await assert.rejects(
    async () => {
      await restoreDatabase({ dumpDir: './non-existent', targetDatabase: 'legacy-hub-db' });
    },
    /REFUSAL: Target database cannot be the live database 'legacy-hub-db'/
  );

  // Non-live names must pass the check
  assert.doesNotThrow(() => checkTargetDatabase('legacy-hub-test-db'));
  assert.doesNotThrow(() => checkTargetDatabase('legacy-hub-staging-db'));
});

test('2. Scheduled backup Worker discovers all tables from sqlite_master and uploads to R2', async () => {
  const db = createSeededDatabase();
  const d1 = d1Adapter(db);
  const bucket = new MockR2Bucket();

  const env = { DB: d1, BACKUPS: bucket };
  const mockNow = new Date('2026-09-24T03:00:00Z');

  const res = await runBackup(env, { now: mockNow, retentionDays: 30 });

  assert.equal(res.success, true);
  assert.equal(res.date, '2026-09-24');
  assert.equal(res.prefix, 'legacy-hub/2026-09-24');

  // Verify that agent_change (from schema 0008) is discovered without hardcoding
  assert.ok('agent_change' in res.tables, 'agent_change table must be discovered dynamically');
  assert.ok('caregiver' in res.tables);
  assert.ok('grant_application' in res.tables);
  assert.ok('award' in res.tables);
  assert.ok('audit_log' in res.tables);

  // Verify manifest.json in R2
  const manifestObj = await bucket.get('legacy-hub/2026-09-24/manifest.json');
  assert.ok(manifestObj, 'manifest.json must exist in R2 bucket');
  const manifest = await manifestObj.json();
  assert.equal(manifest.latest_migration, '0012_wellness_checkin.sql');
  assert.equal(manifest.total_rows, res.totalRows);
  assert.equal(manifest.tables.caregiver, 2);
  assert.equal(manifest.tables.agent_change, 1);
  assert.equal(manifest.tables.grant_application, 2);

  // Verify table dump files in R2
  const cgObj = await bucket.get('legacy-hub/2026-09-24/caregiver.json');
  assert.ok(cgObj, 'caregiver.json must exist in R2');
  const cgRows = await cgObj.json();
  assert.equal(cgRows.length, 2);
  const synthCg = cgRows.find((c) => c.id === 'cg_synthetic_1001');
  assert.ok(synthCg);
  assert.equal(synthCg.first_name, 'Jane');
});

test('3. Retention prunes exactly the expired keys older than 30 days', async () => {
  const bucket = new MockR2Bucket();
  const now = new Date('2026-09-24T12:00:00Z');

  // 35 days ago (expired)
  await bucket.put('legacy-hub/2026-08-15/caregiver.json', '[]');
  await bucket.put('legacy-hub/2026-08-15/manifest.json', '{}');
  // 31 days ago (expired: cutoff is 2026-08-25)
  await bucket.put('legacy-hub/2026-08-20/event.json', '[]');

  // 29 days ago (retained)
  await bucket.put('legacy-hub/2026-08-26/caregiver.json', '[]');
  // 10 days ago (retained)
  await bucket.put('legacy-hub/2026-09-14/manifest.json', '{}');
  // Today (retained)
  await bucket.put('legacy-hub/2026-09-24/manifest.json', '{}');

  const pruned = await pruneOldBackups(bucket, now, 30);
  assert.equal(pruned, 3, 'Must prune exactly the 3 expired keys');

  // Verify remaining keys
  const list = await bucket.list({ prefix: 'legacy-hub/' });
  const remainingKeys = list.objects.map((o) => o.key);
  assert.equal(remainingKeys.length, 3);
  assert.ok(remainingKeys.includes('legacy-hub/2026-08-26/caregiver.json'));
  assert.ok(remainingKeys.includes('legacy-hub/2026-09-14/manifest.json'));
  assert.ok(remainingKeys.includes('legacy-hub/2026-09-24/manifest.json'));
});

test('4. On-demand export (scripts/export-all.mjs) writes dump files and manifest', async () => {
  const db = createSeededDatabase();
  const tempExportDir = join(ROOT_DIR, 'tests', 'fixtures', 'temp-export-test');

  try {
    const res = await exportDatabase({
      db,
      outputDir: tempExportDir,
      schemaDir: SCHEMAS_DIR
    });

    assert.ok(existsSync(join(tempExportDir, 'manifest.json')));
    assert.ok(existsSync(join(tempExportDir, 'caregiver.json')));
    assert.ok(existsSync(join(tempExportDir, 'agent_change.json')));
    assert.ok(existsSync(join(tempExportDir, 'audit_log.json')));

    const manifest = JSON.parse(readFileSync(join(tempExportDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.latest_migration, '0012_wellness_checkin.sql');
    assert.equal(manifest.tables.caregiver, 2);
    assert.equal(manifest.tables.grant_application, 2);
    assert.equal(manifest.tables.award, 1);
  } finally {
    if (existsSync(tempExportDir)) {
      rmSync(tempExportDir, { recursive: true, force: true });
    }
  }
});

test('5. Round trip dump -> restore recreates schema, identical counts, and spot-checks relationships', async () => {
  const sourceDb = createSeededDatabase();
  const tempDumpDir = join(ROOT_DIR, 'tests', 'fixtures', 'temp-roundtrip-dump');

  try {
    // 1. Export source database to dump dir
    await exportDatabase({
      db: sourceDb,
      outputDir: tempDumpDir,
      schemaDir: SCHEMAS_DIR
    });

    // 2. Prepare completely empty destination database
    const targetDb = new DatabaseSync(':memory:');

    // 3. Restore into target database
    const restoreRes = await restoreDatabase({
      dumpDir: tempDumpDir,
      targetDatabase: 'legacy-hub-test-db',
      db: targetDb,
      schemaDir: SCHEMAS_DIR
    });

    assert.equal(restoreRes.success, true);
    assert.equal(restoreRes.targetDatabase, 'legacy-hub-test-db');

    // 4. Verify verified row counts match manifest
    assert.equal(restoreRes.verifiedCounts.caregiver, 2);
    assert.equal(restoreRes.verifiedCounts.grant_application, 2);
    assert.equal(restoreRes.verifiedCounts.award, 1);
    assert.equal(restoreRes.verifiedCounts.followup, 1);
    assert.equal(restoreRes.verifiedCounts.contact_history, 1);
    assert.equal(restoreRes.verifiedCounts.note, 1);
    assert.equal(restoreRes.verifiedCounts.agent_change, 1);
    assert.equal(restoreRes.verifiedCounts.audit_log, 1);

    // 5. Verify relationship spot checks
    const sc = restoreRes.spotChecks;
    assert.equal(sc.caregiverFound, true);
    assert.equal(sc.caregiverId, 'cg_synthetic_1001');
    assert.equal(sc.hasGrant, true);
    assert.equal(sc.grantId, 501);
    assert.equal(sc.hasAward, true);
    assert.equal(sc.awardId, 701);
    assert.equal(sc.followupCount, 1);
    assert.equal(sc.contactHistoryCount, 1);
    assert.equal(sc.noteCount, 1);
    assert.equal(sc.auditLogPreserved, true);
    assert.equal(sc.auditLogCount, 1);
  } finally {
    if (existsSync(tempDumpDir)) {
      rmSync(tempDumpDir, { recursive: true, force: true });
    }
  }
});

test('6. Backup Worker has no public HTTP route (returns 404)', async () => {
  const req = new Request('https://worker.local/api/export');
  const res = await backupWorker.fetch(req, {}, {});
  assert.equal(res.status, 404);
});

test('7. Restore resolves database id from wrangler d1 list and never emits -id placeholders', async () => {
  const mockDbs = [
    { name: 'legacy-hub-db-restore-drill', uuid: '17be929b-64e8-43e0-9e0e-702775f7073a' },
    { name: 'other-database', uuid: '22222222-3333-4444-5555-666666666666' }
  ];

  const mockExec = (cmd) => {
    if (cmd.includes('wrangler d1 list --json')) {
      return JSON.stringify(mockDbs);
    }
    throw new Error(`Unexpected command: ${cmd}`);
  };

  // 1. Resolve by database name
  const resolvedId = resolveDatabaseId('legacy-hub-db-restore-drill', { execFn: mockExec });
  assert.equal(resolvedId, '17be929b-64e8-43e0-9e0e-702775f7073a');

  // 2. Direct UUID does not invoke wrangler
  let calledWrangler = false;
  const directId = resolveDatabaseId('17be929b-64e8-43e0-9e0e-702775f7073a', {
    execFn: () => { calledWrangler = true; }
  });
  assert.equal(directId, '17be929b-64e8-43e0-9e0e-702775f7073a');
  assert.equal(calledWrangler, false, 'UUID should be accepted directly without invoking wrangler');

  // 3. createTempWranglerConfig creates valid TOML with real UUID
  const configPath = createTempWranglerConfig('legacy-hub-db-restore-drill', resolvedId);
  try {
    assert.ok(existsSync(configPath), 'Temp config file must be created');
    const tomlContent = readFileSync(configPath, 'utf8');
    assert.ok(tomlContent.includes('database_id = "17be929b-64e8-43e0-9e0e-702775f7073a"'));
    assert.ok(!tomlContent.includes('-id"'), 'Must never emit -id placeholder');
  } finally {
    if (existsSync(configPath)) rmSync(configPath);
  }

  // 4. createTempWranglerConfig strictly throws on placeholder IDs
  assert.throws(
    () => createTempWranglerConfig('legacy-hub-db-restore-drill', 'legacy-hub-db-restore-drill-id'),
    /placeholder IDs ending in -id/
  );
  assert.throws(
    () => createTempWranglerConfig('legacy-hub-db-restore-drill', null),
    /Invalid database ID/
  );

  // 5. Unknown database throws clear error
  assert.throws(
    () => resolveDatabaseId('unknown-db', { execFn: mockExec }),
    /Database 'unknown-db' not found in wrangler d1 list/
  );
});

test('8. Batch size is respected during data restore', async () => {
  // Test chunkArray helper
  const items = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `item_${i + 1}` }));
  const chunks = chunkArray(items, 3);
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map((c) => c.length), [3, 3, 3, 2]);

  // Test restore with batchSize
  const testDb = new DatabaseSync(':memory:');
  const tempDumpDir = join(ROOT_DIR, 'tests', 'fixtures', 'temp-batch-dump');
  try {
    // Export standard seeded database
    const sourceDb = createSeededDatabase();
    await exportDatabase({
      db: sourceDb,
      outputDir: tempDumpDir,
      schemaDir: SCHEMAS_DIR
    });

    const res = await restoreDatabase({
      dumpDir: tempDumpDir,
      targetDatabase: 'legacy-hub-batch-test',
      db: testDb,
      schemaDir: SCHEMAS_DIR,
      batchSize: 1 // Force batch size of 1 to ensure batching loop runs per row
    });

    assert.equal(res.success, true);
    assert.equal(res.verifiedCounts.caregiver, 2);
    assert.equal(res.verifiedCounts.grant_application, 2);
    assert.equal(res.verifiedCounts.award, 1);
  } finally {
    if (existsSync(tempDumpDir)) {
      rmSync(tempDumpDir, { recursive: true, force: true });
    }
  }
});

test('9. Manifest migration test: fails if recorded value is older than newest file in schema/', async () => {
  const schemaFiles = readdirSync(SCHEMAS_DIR)
    .filter((f) => /^0\d+.*\.sql$/.test(f))
    .sort();
  assert.ok(schemaFiles.length > 0, 'Schema files must exist');
  const newestSchemaFile = schemaFiles[schemaFiles.length - 1];

  // The backup worker's fallback constant must be >= newest schema file
  assert.equal(
    BAKED_IN_LATEST_MIGRATION,
    newestSchemaFile,
    `BAKED_IN_LATEST_MIGRATION (${BAKED_IN_LATEST_MIGRATION}) must match newest schema migration (${newestSchemaFile})`
  );

  // When runBackup runs against a DB without d1_migrations table, the manifest must record the newest migration
  const mockDb = {
    prepare: (sql) => ({
      all: async () => {
        if (sql.includes('sqlite_master')) {
          return [{ name: 'caregiver' }];
        }
        return [];
      },
      first: async () => {
        if (sql.includes('d1_migrations')) {
          throw new Error('no such table: d1_migrations');
        }
        return null;
      }
    })
  };
  const mockBucket = new MockR2Bucket();
  const backupRes = await runBackup({ DB: mockDb, BACKUPS: mockBucket });
  assert.equal(backupRes.manifest.latest_migration, newestSchemaFile);
  assert.ok(
    backupRes.manifest.latest_migration >= newestSchemaFile,
    `Recorded latest migration (${backupRes.manifest.latest_migration}) cannot be older than newest file in schema/ (${newestSchemaFile})`
  );
});

// [pc2-codex-13] Sequential completed-prefix protection, not native R2/D1 or concurrency proof.
function backupPrefixFixture() {
  const bucket = new MockR2Bucket();
  const rows = { alpha: [{ id: 'a', value: 'original-alpha' }], beta: [{ id: 'b', value: 'original-beta' }] };
  const calls = { head: [], prepare: [], put: [], list: [], delete: [] };
  for (const method of ['head', 'put', 'list', 'delete']) {
    const original = bucket[method].bind(bucket);
    bucket[method] = async (...args) => {
      calls[method].push(args[0]);
      return original(...args);
    };
  }
  const db = {
    prepare(sql) {
      calls.prepare.push(sql);
      return {
        async all() {
          if (sql.includes('sqlite_master')) return { results: [{ name: 'alpha' }, { name: 'beta' }] };
          const match = sql.match(/^SELECT \* FROM "(alpha|beta)"$/);
          assert.ok(match, 'only synthetic table SELECTs are allowed');
          return { results: rows[match[1]] };
        },
        async first() {
          assert.equal(sql, 'SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1');
          return { name: '0012_wellness_checkin.sql' };
        }
      };
    }
  };
  return {
    bucket, rows, calls, env: { DB: db, BACKUPS: bucket },
    snapshot: () => structuredClone([...bucket.store.entries()].sort(([a], [b]) => a.localeCompare(b))),
    reset: () => { for (const method of Object.keys(calls)) calls[method].length = 0; }
  };
}

for (const [label, prefix] of [['default date', undefined], ['explicit prefix', 'legacy-hub/synthetic-selected-prefix']]) {
  test(`10. Completed backup ${label} refuses repeat before reads, overwrites or pruning`, async () => {
    const f = backupPrefixFixture();
    const options = { now: '2026-10-06T03:00:00.000Z', ...(prefix ? { prefix } : {}) };
    const first = await runBackup(f.env, options);
    assert.equal(first.success, true);
    f.bucket.store.set('legacy-hub/2026-09-01/unrelated-expired.json', { value: 'preserve-on-refusal', metadata: {} });
    const before = f.snapshot();
    f.rows.alpha.push({ id: 'a2', value: 'changed-second-run' });
    f.reset();
    // Reproduce the old failure mode if the guard ever disappears.
    const originalPut = f.bucket.put.bind(f.bucket);
    f.bucket.put = async (...args) => {
      if (f.calls.put.length === 1) {
        f.calls.put.push(args[0]);
        throw new Error('synthetic second-put failure');
      }
      return originalPut(...args);
    };
    let refusal;
    try { await runBackup(f.env, { ...options, now: '2026-10-06T04:00:00.000Z' }); }
    catch (error) { refusal = error; }
    assert.deepEqual(f.snapshot(), before, 'all completed table bytes, manifest and unrelated objects must survive');
    assert.match(refusal?.message || '', /completed backup/i);
    assert.deepEqual(f.calls, {
      head: [`${first.prefix}/manifest.json`], prepare: [], put: [], list: [], delete: []
    });
  });
}

test('11. Manifest HEAD lookup failure propagates before any database read or bucket mutation', async () => {
  const f = backupPrefixFixture();
  f.bucket.store.set('legacy-hub/2026-09-01/unrelated.json', { value: 'unchanged', metadata: {} });
  const before = f.snapshot();
  const lookupError = new Error('synthetic HEAD unavailable');
  f.bucket.head = async (key) => { f.calls.head.push(key); throw lookupError; };
  await assert.rejects(runBackup(f.env, { now: '2026-10-06T03:00:00.000Z' }), error => error === lookupError);
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.calls, {
    head: ['legacy-hub/2026-10-06/manifest.json'], prepare: [], put: [], list: [], delete: []
  });
});

test('12. Absent manifest permits the existing complete backup and manifest format', async () => {
  const f = backupPrefixFixture();
  const result = await runBackup(f.env, { now: '2026-10-06T03:00:00.000Z' });
  assert.equal(result.success, true);
  assert.deepEqual(f.calls.head, ['legacy-hub/2026-10-06/manifest.json']);
  assert.deepEqual(f.calls.put, ['legacy-hub/2026-10-06/alpha.json', 'legacy-hub/2026-10-06/beta.json', 'legacy-hub/2026-10-06/manifest.json']);
  assert.equal(f.calls.list.length, 1);
  assert.equal(f.calls.delete.length, 0);
  assert.deepEqual(JSON.parse(f.bucket.store.get('legacy-hub/2026-10-06/manifest.json').value), {
    version: 1, timestamp: '2026-10-06T03:00:00.000Z', latest_migration: '0012_wellness_checkin.sql',
    tables: { alpha: 1, beta: 1 }, total_rows: 2
  });
});

test('13. A different date backs up new rows while preserving the completed prior prefix', async () => {
  const f = backupPrefixFixture();
  await runBackup(f.env, { now: '2026-10-06T03:00:00.000Z' });
  const before = f.snapshot();
  f.rows.alpha.push({ id: 'a2', value: 'new-day' });
  f.reset();
  const result = await runBackup(f.env, { now: '2026-10-07T03:00:00.000Z' });
  assert.deepEqual(result.tables, { alpha: 2, beta: 1 });
  assert.deepEqual(f.calls.head, ['legacy-hub/2026-10-07/manifest.json']);
  assert.equal(f.calls.put.length, 3);
  for (const [key, item] of before) assert.deepEqual(f.bucket.store.get(key), item);
});

test('14. Existing manifest object is preserved without downloading or repairing its body', async () => {
  const f = backupPrefixFixture();
  f.bucket.store.set('legacy-hub/2026-10-06/manifest.json', { value: 'historical opaque bytes', metadata: { custom: 'preserve' } });
  const before = f.snapshot();
  await assert.rejects(runBackup(f.env, { now: '2026-10-06T03:00:00.000Z' }), /completed backup/i);
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(f.calls, {
    head: ['legacy-hub/2026-10-06/manifest.json'], prepare: [], put: [], list: [], delete: []
  });
});

// [pc2-codex-13] Local completion-entry protection; no exporter CLI or real backup fixtures.
async function withLocalExportFixture(caseName, run) {
  const fixtureRoot = join(ROOT_DIR, 'tests', 'fixtures', 'temp-export-completion-test');
  assert.equal(existsSync(fixtureRoot), false, 'the sole synthetic fixture root must start absent');
  try {
    await run(join(fixtureRoot, caseName));
  } finally {
    assert.equal(dirname(fixtureRoot), join(ROOT_DIR, 'tests', 'fixtures'));
    if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function localExportFixture() {
  const calls = [];
  const state = { second: false };
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        async all() {
          if (sql.includes('sqlite_master')) return { results: [{ name: 'alpha' }, { name: 'beta' }] };
          assert.match(sql, /^SELECT \* FROM (alpha|beta)$/);
          if (sql.endsWith('beta')) {
            if (state.second) throw new Error('synthetic beta SELECT failure');
            return { results: [{ id: 'b', value: 'original-beta' }] };
          }
          return { results: state.second
            ? [{ id: 'a', value: 'changed-alpha' }, { id: 'a2', value: 'added-alpha' }]
            : [{ id: 'a', value: 'original-alpha' }] };
        }
      };
    }
  };
  return { db, calls, state };
}

function localExportSnapshot(root, base = root) {
  const entries = [];
  for (const item of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, item.name);
    const key = path.slice(base.length + 1);
    if (item.isDirectory()) {
      entries.push([key, 'directory']);
      entries.push(...localExportSnapshot(path, base));
    } else {
      entries.push([key, readFileSync(path)]);
    }
  }
  return entries;
}

test('15. Completed local export preserves all bytes and refuses repeat before any database call', async () => {
  await withLocalExportFixture('completed', async outputDir => {
    const f = localExportFixture();
    const first = await exportDatabase({ db: f.db, outputDir, schemaDir: SCHEMAS_DIR });
    assert.deepEqual(first.tables, { alpha: 1, beta: 1 });
    writeFileSync(join(outputDir, 'unrelated.txt'), 'preserve this unrelated synthetic file');
    const before = localExportSnapshot(outputDir);
    f.state.second = true;
    f.calls.length = 0;
    let refusal;
    try { await exportDatabase({ db: f.db, outputDir, schemaDir: SCHEMAS_DIR }); }
    catch (error) { refusal = error; }
    assert.deepEqual(localExportSnapshot(outputDir), before);
    assert.match(refusal?.message || '', /completed export/i);
    assert.deepEqual(f.calls, []);
  });
});

test('16. Opaque local completion marker is preserved without parsing or repair', async () => {
  await withLocalExportFixture('opaque', async outputDir => {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'manifest.json'), 'historical opaque marker bytes');
    const before = localExportSnapshot(outputDir);
    const f = localExportFixture();
    await assert.rejects(exportDatabase({ db: f.db, outputDir, schemaDir: SCHEMAS_DIR }), /completed export/i);
    assert.deepEqual(localExportSnapshot(outputDir), before);
    assert.deepEqual(f.calls, []);
  });
});

test('17. Fresh local output without a completion marker retains the existing export format', async () => {
  await withLocalExportFixture('fresh', async outputDir => {
    assert.equal(existsSync(outputDir), false);
    const f = localExportFixture();
    const result = await exportDatabase({ db: f.db, outputDir, schemaDir: SCHEMAS_DIR });
    assert.equal(result.outputDir, outputDir);
    assert.deepEqual(result.tables, { alpha: 1, beta: 1 });
    assert.equal(result.totalRows, 2);
    assert.deepEqual(readdirSync(outputDir).sort(), ['alpha.json', 'beta.json', 'manifest.json']);
    assert.deepEqual(JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8')), {
      version: 1, timestamp: result.manifest.timestamp, latest_migration: '0012_wellness_checkin.sql',
      tables: { alpha: 1, beta: 1 }, total_rows: 2
    });
  });
});

test('18. A directory at the completion marker refuses without new files or database reads', async () => {
  await withLocalExportFixture('directory-marker', async outputDir => {
    mkdirSync(join(outputDir, 'manifest.json'), { recursive: true });
    writeFileSync(join(outputDir, 'manifest.json', 'unchanged.txt'), 'keep this synthetic entry');
    const before = localExportSnapshot(outputDir);
    const f = localExportFixture();
    let refusal;
    try { await exportDatabase({ db: f.db, outputDir, schemaDir: SCHEMAS_DIR }); }
    catch (error) { refusal = error; }
    assert.deepEqual(localExportSnapshot(outputDir), before);
    assert.match(refusal?.message || '', /completed export/i);
    assert.deepEqual(f.calls, []);
  });
});
