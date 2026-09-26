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
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
  '0010_page_section_forms.sql'
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
  assert.equal(manifest.latest_migration, '0010_page_section_forms.sql');
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
    assert.equal(manifest.latest_migration, '0010_page_section_forms.sql');
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

