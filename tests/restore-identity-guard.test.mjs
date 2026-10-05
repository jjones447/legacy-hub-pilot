// [pc2-codex-13] Identity mocks plus finite owned temp fixtures and synthetic
// in-memory SQLite preflight tests; no subprocesses, providers or actual D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, rmdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PROTECTED_DATABASE_ID, checkTargetDatabase, resolveRestoreTarget, restoreDatabase
} from '../scripts/restore-from-backup.mjs';

const scratchId = '17be929b-64e8-43e0-9e0e-702775f7073a';
const changedLiveId = '22222222-3333-4444-5555-666666666666';
const scratch = { name: 'legacy-hub-restore-synthetic', uuid: scratchId };
function metadata(records) {
  return (command) => {
    assert.equal(command, 'npx wrangler d1 list --json');
    return JSON.stringify(records);
  };
}
function forbiddenCommand() {
  assert.fail('No identity lookup or execution should occur');
}

test('live name and configured UUID are refused with case and whitespace variations', () => {
  for (const target of ['legacy-hub-db', ' LEGACY-HUB-DB ', PROTECTED_DATABASE_ID,
    ` ${PROTECTED_DATABASE_ID.toUpperCase()} `]) {
    assert.throws(() => checkTargetDatabase(target), /REFUSAL/);
    assert.throws(() => resolveRestoreTarget({ targetDatabase: target, execFn: forbiddenCommand }), /REFUSAL/);
  }
});

test('explicit live UUID override is refused before metadata lookup', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: scratch.name, databaseId: PROTECTED_DATABASE_ID, execFn: forbiddenCommand
  }), /live database UUID/);
});

test('resolved production name is refused even with a changed production UUID', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: changedLiveId,
    execFn: metadata([{ name: 'legacy-hub-db', uuid: changedLiveId }])
  }), /live database 'legacy-hub-db'/);
});

test('scratch-looking alias to configured production UUID is refused', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: scratch.name,
    execFn: metadata([{ name: scratch.name, uuid: PROTECTED_DATABASE_ID }])
  }), /live database UUID/);
});

test('duplicate metadata identity alias to live is refused', () => {
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    execFn: metadata([scratch, { name: 'legacy-hub-db', uuid: scratchId }])
  }), /aliases the live database/);
});

test('scratch name and UUID both resolve only via verified metadata', () => {
  for (const target of [scratch.name, scratchId.toUpperCase()]) {
    assert.deepEqual(resolveRestoreTarget({ targetDatabase: target,
      execFn: metadata([scratch]) }), { name: scratch.name, uuid: scratchId });
  }
});

test('explicit safe ID must match resolved identity', () => {
  assert.deepEqual(resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: scratchId.toUpperCase(), execFn: metadata([scratch]) }), scratch);
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: changedLiveId, execFn: metadata([scratch]) }), /does not match/);
});

test('custom config override is refused without reading it or running commands', () => {
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    configPath: './unread-untrusted-config.toml', execFn: forbiddenCommand }), /Custom restore configuration/);
});

test('missing, ambiguous, malformed and failed identity lookup fail closed', () => {
  for (const records of [[], [scratch, scratch], {},
    [{ name: scratch.name, uuid: 'not-a-uuid' }], [{ name: 'unsafe name', uuid: scratchId }]]) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase: scratchId,
      execFn: metadata(records) }));
  }
  for (const execFn of [() => '{invalid', () => { throw new Error('offline'); }]) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name, execFn }), /Cannot verify/);
  }
});

test('invalid CLI target or explicit ID cannot reach lookup', () => {
  for (const targetDatabase of ['scratch" --remote', 'scratch;rm', 'scratch\nname', '--remote']) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase, execFn: forbiddenCommand }), /Invalid restore target/);
  }
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: 'placeholder-id', execFn: forbiddenCommand }), /Invalid explicit database ID/);
});

test('restore entry refuses unsafe identity before accessing dump or SQL', async () => {
  for (const options of [
    { targetDatabase: PROTECTED_DATABASE_ID },
    { targetDatabase: scratch.name, databaseId: PROTECTED_DATABASE_ID },
    { targetDatabase: scratch.name, configPath: './unread.toml' },
    { targetDatabase: changedLiveId, execFn: metadata([{ name: 'legacy-hub-db', uuid: changedLiveId }]) }
  ]) {
    await assert.rejects(restoreDatabase({ ...options,
      execFn: options.execFn ?? forbiddenCommand, dumpDir: undefined }), /REFUSAL/);
  }
});

test('direct synthetic fixtures reject CLI overrides without accessing db', async () => {
  for (const override of [{ databaseId: scratchId }, { configPath: './unread.toml' }]) {
    await assert.rejects(restoreDatabase({ targetDatabase: scratch.name, db: {},
      ...override, dumpDir: undefined, execFn: forbiddenCommand }), /fixtures cannot carry/);
  }
});


// Preflight fixture tests use only finite task-owned temp files and synthetic SQLite.
// No CLI branch, subprocess, provider or real D1 execution. Cached snapshots cost
// memory; this preflight does not make later schema/SQL/runtime restore atomic.
const fixtureSchema = [
  'CREATE TABLE caregiver(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, score REAL, enabled INTEGER, optional TEXT, updated_at TEXT);',
  'CREATE TABLE grant_application(id INTEGER PRIMARY KEY, caregiver_id TEXT);',
  'CREATE TABLE award(id INTEGER PRIMARY KEY, grant_application_id INTEGER);',
  'CREATE TABLE followup(id INTEGER PRIMARY KEY, caregiver_id TEXT);',
  'CREATE TABLE contact_history(id INTEGER PRIMARY KEY, caregiver_id TEXT);',
  'CREATE TABLE note(id INTEGER PRIMARY KEY, caregiver_id TEXT);',
  'CREATE TABLE audit_log(id INTEGER PRIMARY KEY, actor TEXT, action TEXT, before_json TEXT, after_json TEXT, at TEXT);',
  'CREATE TABLE future_table_2027(id TEXT PRIMARY KEY, value TEXT);'
].join('\n');
const fixtureRow = { id: 'cg_synthetic', first_name: "Synthetic O'Example", last_name: 'Fixture',
  score: 1.5, enabled: true, optional: null, updated_at: '2000-01-01T00:00:00Z' };
const fixtureAudit = { id: 7, actor: 'synthetic_staff', action: 'synthetic.original',
  before_json: '{"old":true}', after_json: '{"new":true}', at: '2000-01-01T00:00:00Z' };

function preflightFixture() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'legacy-restore-preflight-pc2-codex-13-')));
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('legacy-restore-preflight-pc2-codex-13-'));
  const dumpDir = join(root, 'dump');
  const schemaDir = join(root, 'schema');
  mkdirSync(dumpDir); mkdirSync(schemaDir);
  const files = new Set();
  const write = (relative, text) => {
    const path = resolve(root, relative);
    assert.ok(path.startsWith(root + sep), 'fixture writes stay inside exact own temp root');
    writeFileSync(path, text, 'utf8');
    files.add(path);
  };
  write('schema/001-fixture.sql', fixtureSchema);
  const manifest = { version: 1, timestamp: '2000-01-01T00:00:00Z',
    latest_migration: '001-fixture.sql', total_rows: 2,
    extra_metadata: { preserved: true }, tables: { caregiver: 1, audit_log: 1 } };
  write('dump/manifest.json', JSON.stringify(manifest));
  write('dump/caregiver.json', JSON.stringify([fixtureRow]));
  write('dump/audit_log.json', JSON.stringify([fixtureAudit]));
  const database = new DatabaseSync(':memory:');
  const rawExec = database.exec.bind(database);
  const rawPrepare = database.prepare.bind(database);
  rawExec("CREATE TABLE prior_marker(id INTEGER PRIMARY KEY,label TEXT); INSERT INTO prior_marker VALUES(1,'SYNTHETIC_PRIOR');");
  const trace = [];
  const state = () => {
    const schema = rawPrepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const tables = Object.fromEntries(schema.filter(r => r.type === 'table').map(r => [
      r.name, rawPrepare('SELECT * FROM "' + r.name + '" ORDER BY rowid').all()
    ]));
    return JSON.parse(JSON.stringify({ schema, tables, foreignKeys: rawPrepare('PRAGMA foreign_keys').get() }));
  };
  let onFirstMutation = null, begun = false, cliCalls = 0;
  database.exec = sql => {
    trace.push({ method: 'exec', sql });
    if (!begun) { begun = true; onFirstMutation?.(); }
    return rawExec(sql);
  };
  database.prepare = sql => {
    trace.push({ method: 'prepare', sql });
    const stmt = rawPrepare(sql);
    return {
      all(...args) { trace.push({ method: 'all', sql, args }); return stmt.all(...args); },
      get(...args) { trace.push({ method: 'get', sql, args }); return stmt.get(...args); },
      run(...args) { trace.push({ method: 'run', sql, args }); return stmt.run(...args); }
    };
  };
  const restore = () => restoreDatabase({ dumpDir, schemaDir, targetDatabase: scratch.name,
    db: database, execFn() { cliCalls++; assert.fail('FORBIDDEN_CLI_OR_SUBPROCESS'); } });
  return { root, dumpDir, schemaDir, database, manifest, trace, state, write, restore,
    hook(fn) { onFirstMutation = fn; },
    get cliCalls() { return cliCalls; },
    remove(relative) {
      const path = resolve(root, relative);
      assert.ok(files.has(path));
      unlinkSync(path); files.delete(path);
    },
    cleanup() {
      database.close();
      for (const path of files) {
        assert.ok(path.startsWith(root + sep));
        unlinkSync(path);
      }
      assert.deepEqual(readdirSync(dumpDir), []);
      assert.deepEqual(readdirSync(schemaDir), []);
      rmdirSync(dumpDir); rmdirSync(schemaDir);
      assert.deepEqual(readdirSync(root), []);
      rmdirSync(root);
      assert.equal(existsSync(root), false);
    }
  };
}
const invalidSnapshots = [
  ['missing table file', f => f.remove('dump/caregiver.json')],
  ['malformed table JSON', f => f.write('dump/caregiver.json', '{"ROW_VALUE_CANARY":')],
  ['non-array table object', f => f.write('dump/caregiver.json', '{"ROW_VALUE_CANARY":true}')],
  ['null manifest tables', f => f.write('dump/manifest.json', '{"tables":null}')],
  ['missing manifest tables', f => f.write('dump/manifest.json', '{}')],
  ['negative count', f => { f.manifest.tables.caregiver = -1; }],
  ['fraction count', f => { f.manifest.tables.caregiver = 0.5; }],
  ['string count', f => { f.manifest.tables.caregiver = '1'; }],
  ['row count mismatch', f => { f.manifest.tables.caregiver = 2; }],
  ['empty manifest tables', f => f.write('dump/manifest.json', '{"tables":{}}')],
  ['array manifest tables', f => f.write('dump/manifest.json', '{"tables":["caregiver"]}')],
  ['null manifest', f => f.write('dump/manifest.json', 'null')],
  ['array manifest', f => f.write('dump/manifest.json', '[]')],
  ['malformed manifest', f => f.write('dump/manifest.json', '{"ROW_VALUE_CANARY":')],
  ['missing manifest', f => f.remove('dump/manifest.json')],
  ['unsafe count', f => { f.manifest.tables.caregiver = Number.MAX_SAFE_INTEGER + 1; }],
  ['null count', f => { f.manifest.tables.caregiver = null; }],
  ['boolean count', f => { f.manifest.tables.caregiver = true; }],
  ['nonfinite count', f => f.write('dump/manifest.json', '{"tables":{"caregiver":1e400}}')],
  ['missing zero-count file', f => { f.manifest.tables.audit_log = 0; f.remove('dump/audit_log.json'); }],
  ['traversal table identifier', f => { f.manifest.tables['../ROW_VALUE_CANARY'] = 0; }],
  ['quoted table identifier', f => { f.manifest.tables['ROW_VALUE_CANARY"'] = 0; }],
  ['backslash table identifier', f => { f.manifest.tables['ROW_VALUE_CANARY\\x'] = 0; }],
  ['empty table identifier', f => { f.manifest.tables[''] = 0; }],
  ['quoted column identifier', f => f.write('dump/caregiver.json', '[{"id":"cg_synthetic","ROW_VALUE_CANARY\\"":1}]')],
  ['slash column identifier', f => f.write('dump/caregiver.json', '[{"id":"cg_synthetic","ROW_VALUE_CANARY/x":1}]')],
  ['empty column identifier', f => f.write('dump/caregiver.json', '[{"":1}]')],
  ['null row', f => f.write('dump/caregiver.json', '[null]')],
  ['array row', f => f.write('dump/caregiver.json', '[["ROW_VALUE_CANARY"]]')],
  ['primitive row', f => f.write('dump/caregiver.json', '["ROW_VALUE_CANARY"]')],
  ['empty row', f => f.write('dump/caregiver.json', '[{}]')],
  ['object cell', f => f.write('dump/caregiver.json', '[{"id":"cg_synthetic","first_name":{"private":"ROW_VALUE_CANARY"}}]')],
  ['array cell', f => f.write('dump/caregiver.json', '[{"id":"cg_synthetic","first_name":["ROW_VALUE_CANARY"]}]')],
  ['nonfinite cell', f => f.write('dump/caregiver.json', '[{"id":"cg_synthetic","score":1e400}]')]
];
for (const [name, change] of invalidSnapshots) test('preflight: rejects ' + name + ' before any target SQL', async () => {
  const f = preflightFixture();
  try {
    change(f);
    // Mutations to the manifest object are serialized; explicit malformed/shape fixtures stay as written.
    if (!['null manifest tables','missing manifest tables','empty manifest tables','array manifest tables',
      'null manifest','array manifest','malformed manifest','missing manifest','nonfinite count'].includes(name)) {
      f.write('dump/manifest.json', JSON.stringify(f.manifest));
    }
    const before = f.state();
    let error;
    try { await f.restore(); } catch (failure) { error = failure; }
    assert.ok(error);
    assert.deepEqual(f.state(), before, 'entire schema, prior rows and foreign-key state untouched');
    assert.deepEqual(f.trace, [], 'no db.exec or db.prepare before input rejection');
    assert.match(error.message, /^REFUSAL:/);
    assert.equal(error.message.includes('ROW_VALUE_CANARY'), false, 'no raw row/parse snippets in errors');
    assert.equal(f.cliCalls, 0);
    // Fix the fixture and prove a healthy retry works without target state repair.
    f.write('dump/manifest.json', JSON.stringify({ ...f.manifest, tables: { caregiver: 1, audit_log: 1 } }));
    f.write('dump/caregiver.json', JSON.stringify([fixtureRow]));
    f.write('dump/audit_log.json', JSON.stringify([fixtureAudit]));
    assert.equal((await f.restore()).success, true);
    assert.deepEqual(f.state().tables.audit_log, [fixtureAudit]);
  } finally { f.cleanup(); }
});

test('preflight: healthy full scalar rows, metadata and legal future table survive restore', async () => {
  const f = preflightFixture();
  try {
    f.manifest.tables.future_table_2027 = 1;
    f.manifest.total_rows = 3;
    f.write('dump/manifest.json', JSON.stringify(f.manifest));
    f.write('dump/future_table_2027.json', '[{"id":"future_1","value":"unchanged"}]');
    const result = await f.restore();
    assert.equal(result.success, true);
    assert.deepEqual(result.manifest, f.manifest);
    assert.deepEqual(result.verifiedCounts, { caregiver: 1, audit_log: 1, future_table_2027: 1 });
    assert.deepEqual(f.state().tables.caregiver, [{ ...fixtureRow, enabled: 1 }]);
    assert.deepEqual(f.state().tables.audit_log, [fixtureAudit]);
    assert.deepEqual(f.state().tables.future_table_2027, [{ id: 'future_1', value: 'unchanged' }]);
    assert.equal(f.cliCalls, 0);
  } finally { f.cleanup(); }
});

test('preflight: required zero-count files are accepted when present and empty', async () => {
  const f = preflightFixture();
  try {
    f.manifest.tables = { caregiver: 0, audit_log: 0 };
    f.write('dump/manifest.json', JSON.stringify(f.manifest));
    f.write('dump/caregiver.json', '[]');
    f.write('dump/audit_log.json', '[]');
    const result = await f.restore();
    assert.deepEqual(result.verifiedCounts, { caregiver: 0, audit_log: 0 });
    assert.deepEqual(f.state().tables.caregiver, []);
    assert.deepEqual(f.state().tables.audit_log, []);
    assert.equal(f.cliCalls, 0);
  } finally { f.cleanup(); }
});

test('preflight: consumes cached snapshot after files change at first destructive write', async () => {
  const f = preflightFixture();
  try {
    f.hook(() => {
      f.write('dump/manifest.json', '{"tables":null}');
      f.write('dump/caregiver.json', '{"ROW_VALUE_CANARY":');
      f.remove('dump/audit_log.json');
    });
    const result = await f.restore();
    assert.deepEqual(result.manifest, f.manifest);
    assert.deepEqual(result.verifiedCounts, { caregiver: 1, audit_log: 1 });
    assert.deepEqual(f.state().tables.caregiver, [{ ...fixtureRow, enabled: 1 }]);
    assert.deepEqual(f.state().tables.audit_log, [fixtureAudit]);
    assert.equal(f.cliCalls, 0);
  } finally { f.cleanup(); }
});

test('preflight: later schema failure remains outside input-preflight rollback guarantee', async () => {
  const f = preflightFixture();
  try {
    f.write('schema/001-fixture.sql', 'THIS IS SYNTHETIC INVALID SQL;');
    await assert.rejects(f.restore());
    assert.ok(f.trace.some(t => t.method === 'exec' && t.sql.includes('DROP TABLE')));
    assert.equal('prior_marker' in f.state().tables, false, 'no whole-restore transaction claimed');
    assert.equal(f.cliCalls, 0);
  } finally { f.cleanup(); }
});
