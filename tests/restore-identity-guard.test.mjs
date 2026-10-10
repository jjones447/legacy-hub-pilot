// [pc2-codex-13] Identity mocks plus finite owned temp fixtures and synthetic
// in-memory SQLite preflight tests; no subprocesses, providers or actual D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, rmdirSync, existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PROTECTED_DATABASE_ID, checkTargetDatabase, resolveRestoreTarget, restoreDatabase, buildInsertSql, spotCheckRelationships,
  verifyAuditSnapshot
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
  const restore = (options = {}) => restoreDatabase({ ...options, dumpDir, schemaDir, targetDatabase: scratch.name,
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
const invalidBatchSizes = [
  ['zero', 0], ['negative', -1], ['fraction', 0.5], ['NaN', NaN],
  ['infinity', Infinity], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ['numeric string', '2'], ['null', null], ['boolean', true], ['object', {}]
];
for (const [name, batchSize] of invalidBatchSizes) test('batch preflight: rejects ' + name + ' without target effects', async () => {
  const f = preflightFixture();
  try {
    const before = f.state();
    await assert.rejects(f.restore({ batchSize }), /^Error: REFUSAL: Restore batch size must be a positive safe integer\.$/);
    assert.deepEqual(f.state(), before, 'complete prior schema, rows and foreign-key state preserved');
    assert.deepEqual(f.trace, [], 'no target SQL before batch refusal');
    assert.equal(f.cliCalls, 0);
    for (const db of [null, {}]) {
      await assert.rejects(restoreDatabase({ targetDatabase: scratch.name, db,
        dumpDir: undefined, batchSize, execFn: forbiddenCommand, execFileFn: forbiddenCommand }),
      /REFUSAL: Restore batch size must be a positive safe integer/);
    }
  } finally { f.cleanup(); }
});

test('batch preflight: positive sizes retain synthetic restore behavior', async () => {
  for (const batchSize of [1, 2, 25, Number.MAX_SAFE_INTEGER]) {
    const f = preflightFixture();
    try {
      assert.equal((await f.restore({ batchSize })).success, true);
      assert.deepEqual(f.state().tables.caregiver, [{ ...fixtureRow, enabled: 1 }]);
      assert.deepEqual(f.state().tables.audit_log, [fixtureAudit]);
      assert.equal(f.cliCalls, 0);
    } finally { f.cleanup(); }
  }
});

test('batch CLI parsing: malformed suffixes and fractions are not silently truncated', async () => {
  const source = readFileSync(resolve('scripts/restore-from-backup.mjs'), 'utf8');
  const entry = source.slice(source.indexOf('// CLI entry point'));
  const script = resolve('scripts/restore-from-backup.mjs');
  for (const [input, expected] of [['2junk', NaN], ['1.5', 1.5], ['0', 0], ['2', 2], [undefined, NaN]]) {
    const captured = [];
    vm.runInNewContext(entry, {
      resolve, __filename: script,
      process: { argv: ['synthetic-node', script, 'unread-dump', scratch.name, '--batch-size',
        ...(input === undefined ? [] : [input])], exit() {} },
      console: { error() {} },
      restoreDatabase(options) { captured.push(options); return Promise.resolve(); }
    }, { timeout: 1000 });
    await Promise.resolve();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].batchSize, expected);
  }
});
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


// The trusted current transport callbacks are evaluated without restoreDatabase's
// CLI entry/identity/config path. Map-only file stubs and capture-only execFn
// model dispatch; no Windows shell, Wrangler, provider or real filesystem I/O.
// Query argv is captured through a separate execFileFn stub, never a child.
// Wrangler4.139.0 remote --file returns import statistics, --command SELECT rows:
// https://github.com/cloudflare/workers-sdk/blob/wrangler%404.139.0/packages/wrangler/src/d1/execute.ts
function transportFixture(database, options = {}) {
  const source = readFileSync(new URL('../scripts/restore-from-backup.mjs', import.meta.url), 'utf8');
  const executeStart = source.indexOf('    const executeCmd = (sql) => {');
  const queryStart = source.indexOf('    const queryCmd = (sql,', executeStart);
  const callbackEnd = source.indexOf('    // 0. Drop existing tables', queryStart);
  assert.ok(executeStart > 0 && queryStart > executeStart && callbackEnd > queryStart);
  const callbackSource = source.slice(executeStart, callbackEnd);
  const files = new Map(), fileWrites = [], fileDeletes = [], calls = [];
  const sandbox = {
    ROOT_DIR: '/synthetic-no-filesystem',
    targetDatabase: 'legacy-hub-restore-synthetic',
    localFlag: options.local ? '--local --persist-to "/synthetic-no-persist"' : '--remote',
    effectiveConfig: '/synthetic-no-config.toml',
    isLocal: Boolean(options.local),
    persistDir: '/synthetic-no-persist',
    wranglerEntry: join('/synthetic-no-filesystem', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    process: { execPath: '/synthetic-node.exe' },
    join,
    writeFileSync(path, text, encoding) {
      assert.equal(encoding, 'utf8');
      const bytes = Buffer.from(text, encoding);
      files.set(path, bytes);
      fileWrites.push({ path, bytes });
    },
    existsSync(path) { return files.has(path); },
    unlinkSync(path) { assert.ok(files.has(path)); files.delete(path); fileDeletes.push(path); },
    execFn(command, commandOptions) {
      // Capture only. NEVER pass this string to child_process or any shell.
      let transport, sql, path = null, bytes = null;
      const fileMatch = command.match(/ --file "([^"]+)"$/);
      const commandMatch = command.match(/ --command "([\s\S]*)"$/);
      if (fileMatch) {
        transport = 'file'; path = fileMatch[1];
        assert.ok(files.has(path));
        bytes = Buffer.from(files.get(path));
        sql = bytes.toString('utf8');
      } else if (commandMatch) {
        // Old-source RED capture model only, not genuine Windows argument parsing.
        transport = 'command'; sql = commandMatch[1].replaceAll('\\"', '"');
      } else assert.fail('Unexpected trusted callback transport shape');
      calls.push({ command, options: JSON.parse(JSON.stringify(commandOptions)), transport, sql, path, bytes });
      if (options.failExecutor) throw new Error('SYNTHETIC_EXECUTOR_FAILURE');
      if (Object.hasOwn(options, 'queryResponse')) return options.queryResponse;
      if (command.includes(' --json ')) {
        if (transport === 'file' && !options.local) {
          // Exact remote import response category, NOT fabricated SELECT rows.
          return JSON.stringify([{ results: [{ 'Total queries executed': 1, 'Rows read': 1,
            'Rows written': 0, 'Database size (MB)': '0.00' }], success: true }]);
        }
        return JSON.stringify([{ results: database.prepare(sql).all() }]);
      }
      return '';
    },
    execFileFn(executable, args, commandOptions) {
      const argv = Array.from(args);
      const commandIndex = argv.indexOf('--command');
      assert.ok(commandIndex >= 0 && commandIndex === argv.length - 2);
      const sql = argv[commandIndex + 1];
      calls.push({ transport: 'argv', executable, argv, sql, bytes: Buffer.from(sql, 'utf8'),
        options: JSON.parse(JSON.stringify(commandOptions)) });
      if (options.failExecutor) throw new Error('SYNTHETIC_EXECUTOR_FAILURE');
      if (Object.hasOwn(options, 'queryResponse')) return options.queryResponse;
      return JSON.stringify([{ results: database.prepare(sql).all(), success: true }]);
    }
  };
  assert.equal('require' in sandbox, false);
  const callbacks = vm.runInNewContext(callbackSource + '\n({executeCmd,queryCmd});', sandbox, { timeout: 1000 });
  return { ...callbacks, files, fileWrites, fileDeletes, calls };
}
const transportTexts = [
  ['plain short', 'SQL_DATA_SENTINEL plain'],
  ['LF', 'SQL_DATA_SENTINEL first\nsecond'],
  ['CRLF', 'SQL_DATA_SENTINEL first\r\nsecond'],
  ['tab and repeated spaces', 'SQL_DATA_SENTINEL first\tsecond   third'],
  ['Unicode', 'SQL_DATA_SENTINEL café 漢字 🙂'],
  ['quotes and shell metacharacters', 'SQL_DATA_SENTINEL O\'Example "quoted" $(never-run) $VARIABLE %VARIABLE% & | < > ^ ! ' + String.fromCharCode(96)],
  ['large plain', 'SQL_DATA_SENTINEL ' + 'x'.repeat(5000)],
  ['large multiline Unicode', 'SQL_DATA_SENTINEL café\n漢字\tthree   spaces ' + 'x'.repeat(5000)]
];
for (const [name, text] of transportTexts) {
  for (const local of [false, true]) test('SQL file transport: exact insert ' + name + ' ' + (local ? 'local' : 'remote'), () => {
    const direct = new DatabaseSync(':memory:'), captured = new DatabaseSync(':memory:');
    try {
      direct.exec('CREATE TABLE fixture(id INTEGER,value TEXT);');
      captured.exec('CREATE TABLE fixture(id INTEGER,value TEXT);');
      const f = transportFixture(captured, { local });
      // Include surrounding SQL whitespace: only blank detection may trim a view.
      const sql = ' \r\n' + buildInsertSql('fixture', [{ id: 1, value: text }]) + '\n\t ';
      direct.exec(sql);
      assert.equal(direct.prepare('SELECT value FROM fixture').get().value, text);
      f.executeCmd(sql);
      assert.equal(f.calls.length, 1);
      const call = f.calls[0];
      assert.equal(call.transport, 'file');
      assert.deepEqual(call.bytes, Buffer.from(sql, 'utf8'), 'raw UTF8 file bytes unchanged');
      assert.equal(call.command.includes('SQL_DATA_SENTINEL'), false, 'no SQL payload in shell arguments');
      assert.equal(call.command.includes('--command'), false);
      assert.equal(call.command.includes('--json'), false);
      assert.equal(call.command.includes(local ? '--local --persist-to "/synthetic-no-persist"' : '--remote'), true);
      assert.equal(call.command.includes('-c "/synthetic-no-config.toml"'), true);
      assert.deepEqual(call.options, { cwd: '/synthetic-no-filesystem', stdio: ['ignore', 'pipe', 'pipe'] });
      captured.exec(call.sql);
      assert.deepEqual(captured.prepare('SELECT * FROM fixture').all(), direct.prepare('SELECT * FROM fixture').all());
      assert.equal(f.files.size, 0);
      assert.equal(f.fileWrites.length, 1);
      assert.deepEqual(f.fileDeletes, [call.path]);
    } finally { direct.close(); captured.close(); }
  });
}

for (const [name, text] of transportTexts) {
  for (const local of [false, true]) test('SQL argv query: exact query ' + name + ' ' + (local ? 'local' : 'remote'), () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE fixture(id INTEGER,value TEXT);');
      database.prepare('INSERT INTO fixture VALUES(1,?)').run(text);
      const f = transportFixture(database, { local });
      const sql = " \nSELECT COUNT(*) AS count FROM fixture WHERE value = '" + text.replaceAll("'", "''") + "';\t ";
      const direct = database.prepare(sql).get().count;
      assert.equal(direct, 1);
      const result = f.queryCmd(sql);
      assert.equal(result[0].count, direct);
      const call = f.calls[0];
      assert.equal(call.transport, 'argv');
      assert.equal(call.executable, '/synthetic-node.exe');
      assert.deepEqual(call.bytes, Buffer.from(sql, 'utf8'));
      assert.deepEqual(call.argv, [join('/synthetic-no-filesystem', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
        'd1', 'execute', 'legacy-hub-restore-synthetic',
        ...(local ? ['--local', '--persist-to', '/synthetic-no-persist'] : ['--remote']),
        '-c', '/synthetic-no-config.toml', '--json', '--command', sql]);
      assert.deepEqual(call.options, { cwd: '/synthetic-no-filesystem', encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
      assert.equal(f.files.size, 0);
      assert.deepEqual(f.fileWrites, []);
      assert.deepEqual(f.fileDeletes, []);
    } finally { database.close(); }
  });
}

test('SQL file transport: original JSON audit string bytes survive insert and query', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE audit_log(id INTEGER,actor TEXT,after_json TEXT,at TEXT);');
    const row = { id: 7, actor: 'synthetic_staff', after_json: '{\n  "detail": "two   spaces\\tand Unicode café",\n  "original": true\n}',
      at: '2000-01-01T00:00:00Z' };
    const f = transportFixture(database);
    const sql = buildInsertSql('audit_log', [row]);
    f.executeCmd(sql);
    assert.equal(f.calls[0].transport, 'file');
    assert.deepEqual(f.calls[0].bytes, Buffer.from(sql, 'utf8'));
    database.exec(f.calls[0].sql);
    assert.deepEqual(JSON.parse(JSON.stringify(database.prepare('SELECT * FROM audit_log').get())), row);
    const query = "SELECT COUNT(*) AS count FROM audit_log WHERE after_json = '" + row.after_json.replaceAll("'", "''") + "'";
    assert.equal(f.queryCmd(query)[0].count, 1);
    assert.equal(f.calls[1].transport, 'argv');
    assert.deepEqual(f.calls[1].bytes, Buffer.from(query, 'utf8'));
    assert.equal(f.files.size, 0);
  } finally { database.close(); }
});

test('SQL file transport: blank execution remains a no-op', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const f = transportFixture(database);
    for (const sql of ['', ' ', '\r\n\t   ']) f.executeCmd(sql);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.fileWrites, []);
    assert.deepEqual(f.fileDeletes, []);
    assert.equal(f.files.size, 0);
  } finally { database.close(); }
});

for (const kind of ['execute', 'query']) test('SQL transport: ' + kind + ' executor failure leaves no file', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const f = transportFixture(database, { failExecutor: true });
    assert.throws(() => kind === 'execute' ? f.executeCmd('SELECT 1') : f.queryCmd('SELECT 1'), /SYNTHETIC_EXECUTOR_FAILURE/);
    assert.equal(f.fileWrites.length, kind === 'execute' ? 1 : 0);
    assert.equal(f.calls[0].transport, kind === 'execute' ? 'file' : 'argv');
    assert.equal(f.files.size, 0);
    assert.deepEqual(f.fileDeletes, kind === 'execute' ? [f.fileWrites[0].path] : []);
  } finally { database.close(); }
});

test('SQL argv query: malformed JSON still throws without creating a file', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const f = transportFixture(database, { queryResponse: '{invalid' });
    assert.throws(() => f.queryCmd('SELECT 1'), error => error.name === 'SyntaxError');
    assert.equal(f.fileWrites.length, 0);
    assert.equal(f.files.size, 0);
    assert.deepEqual(f.fileDeletes, []);
  } finally { database.close(); }
});

for (const response of ['[]', '{}', '[{}]', '[{"results":[]}]']) test('SQL argv query: empty-result fallback retained ' + response, () => {
  const database = new DatabaseSync(':memory:');
  try {
    const f = transportFixture(database, { queryResponse: response });
    assert.deepEqual(JSON.parse(JSON.stringify(f.queryCmd('SELECT 1'))), []);
    assert.equal(f.fileWrites.length, 0);
    assert.equal(f.files.size, 0);
    assert.deepEqual(f.fileDeletes, []);
  } finally { database.close(); }
});

test('SQL file transport: repeated execute/query calls get distinct paths and cleanup', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const f = transportFixture(database, { queryResponse: '[]' });
    for (let i = 0; i < 4; i++) { f.executeCmd('SELECT ' + i); f.queryCmd('SELECT ' + i); }
    assert.equal(f.fileWrites.length, 4);
    assert.equal(new Set(f.fileWrites.map(file => file.path)).size, 4);
    assert.equal(f.calls.filter(call => call.transport === 'argv').length, 4);
    assert.deepEqual(f.fileDeletes, f.fileWrites.map(file => file.path));
    assert.equal(f.files.size, 0);
  } finally { database.close(); }
});


for (const isLocal of [false, true]) test('SQL argv entry guard: missing project-local Wrangler refuses before config or target SQL ' + (isLocal ? 'local' : 'remote'), async () => {
  const source = readFileSync(new URL('../scripts/restore-from-backup.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export const PROTECTED_DATABASE_ID');
  const end = source.indexOf('// CLI entry point', start);
  assert.ok(start > 0 && end > start);
  const moduleBody = source.slice(start, end).replace(/^export /gm, '');
  const root = resolve('/synthetic-no-filesystem');
  const dumpDir = join(root, 'dump'), schemaDir = join(root, 'schema');
  const files = new Map([
    [join(dumpDir, 'manifest.json'), '{"tables":{"caregiver":1,"audit_log":0}}'],
    [join(dumpDir, 'caregiver.json'), '[{"id":"cg_synthetic"}]'],
    [join(dumpDir, 'audit_log.json'), '[]']
  ]);
  const writes = [], targetCalls = [], metadataCalls = [];
  const sandbox = {
    ROOT_DIR: root, resolve, join, dirname, process: { env: {}, execPath: '/synthetic-node.exe' },
    existsSync: path => files.has(path),
    readFileSync(path) { assert.ok(files.has(path)); return files.get(path); },
    readdirSync: () => [],
    writeFileSync(...args) { writes.push(args); throw new Error('FORBIDDEN_CONFIG_OR_FILE_WRITE'); },
    unlinkSync(...args) { writes.push(args); throw new Error('FORBIDDEN_FILE_DELETE'); },
    execSync(command) {
      if (command === 'npx wrangler d1 list --json') { metadataCalls.push(command); return JSON.stringify([scratch]); }
      targetCalls.push(command); throw new Error('FORBIDDEN_TARGET_SQL');
    },
    execFileSync(...args) { targetCalls.push(args); throw new Error('FORBIDDEN_REAL_CHILD'); },
    console: { log() {}, error() {} }
  };
  const restore = vm.runInNewContext(moduleBody + '\nrestoreDatabase;', sandbox, { timeout: 1000 });
  await assert.rejects(restore({ dumpDir, schemaDir, targetDatabase: scratch.name, isLocal }), /REFUSAL:.*project-local Wrangler/);
  assert.deepEqual(metadataCalls, ['npx wrangler d1 list --json'], 'existing verified metadata boundary retained');
  assert.deepEqual(writes, [], 'entry guard precedes config and SQL files');
  assert.deepEqual(targetCalls, [], 'entry guard is outside swallowed drop-query block');
});

test('SQL argv query: remote import statistics cannot substitute for SELECT rows', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE fixture(id INTEGER,value TEXT); INSERT INTO fixture VALUES(1,\'Synthetic\');');
    const f = transportFixture(database);
    const result = f.queryCmd('SELECT COUNT(*) AS count FROM fixture');
    assert.equal(result[0].count, 1);
    assert.equal(f.calls[0].transport, 'argv');
    assert.equal(f.files.size, 0);
    assert.equal(f.fileWrites.length, 0);
  } finally { database.close(); }
});

for (const queryResponse of ['[]', '{}', '[{}]', '[{"results":[]}]',
  '[{"results":[],"success":false}]', '[{"results":{},"success":true}]']) {
  test('strict audit query refuses unavailable/failed result ' + queryResponse, async () => {
    const f = transportFixture(null, { queryResponse });
    await assert.rejects(verifyAuditSnapshot(sql => f.queryCmd(sql, { requireRows: true }), []),
      /Audit integrity mismatch/);
    assert.equal(f.fileWrites.length, 0);
  });
}

test('strict audit query accepts explicitly successful empty results', async () => {
  const f = transportFixture(null, { queryResponse: '[{"results":[],"success":true}]' });
  const result = await verifyAuditSnapshot(sql => f.queryCmd(sql, { requireRows: true }), []);
  assert.equal(result.verified, true);
  assert.equal(result.comparedRows, 0);
});

for (const id of [undefined, '7', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test('audit preflight rejects invalid original ID ' + id + ' before target effects', async () => {
    const f = preflightFixture();
    try {
      f.write('dump/audit_log.json', JSON.stringify([{ ...fixtureAudit, id }]));
      const before = f.state();
      await assert.rejects(f.restore(), /Backup audit IDs/);
      assert.deepEqual(f.state(), before);
      assert.deepEqual(f.trace, []);
      assert.equal(f.cliCalls, 0);
    } finally { f.cleanup(); }
  });
}

test('audit preflight rejects duplicate original IDs before target effects', async () => {
  const f = preflightFixture();
  try {
    f.manifest.tables.audit_log = 2;
    f.write('dump/manifest.json', JSON.stringify(f.manifest));
    f.write('dump/audit_log.json', JSON.stringify([fixtureAudit, fixtureAudit]));
    const before = f.state();
    await assert.rejects(f.restore(), /Backup audit IDs/);
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.trace, []);
  } finally { f.cleanup(); }
});

test('audit omitted from supplied snapshot never claims audit preservation', async () => {
  const f = preflightFixture();
  try {
    f.manifest.tables = { caregiver: 1 };
    f.write('dump/manifest.json', JSON.stringify(f.manifest));
    const result = await f.restore();
    assert.equal(result.success, true, 'historical partial snapshots retain count verification');
    assert.equal(result.spotChecks.auditLogPreserved, false);
    assert.equal(result.auditVerification.verified, false);
    assert.equal(result.auditVerification.basis, 'audit-not-in-snapshot');
  } finally { f.cleanup(); }
});


// Pure relationship helper regressions; new cases use no disk/restore/CLI path.
const relationshipCases = [
  { name: 'plain ID', id: 'cg_plain' },
  { name: 'single quote ID', id: 'cg\'quoted' },
  { name: 'repeated quote ID', id: 'cg\'\'repeated' },
  { name: 'read-only OR-looking ID', id: 'cg\' OR 1=1 --' },
  { name: 'Unicode and LF ID', id: 'cg_café\n漢字' },
  { name: 'CRLF ID', id: 'cg_line\r\nbreak' },
  { name: 'zero-related-row control', id: 'cg_zero', counts: [0, 0, 0] },
  { name: 'awarded target precedes unawarded distractor', id: 'zz_awarded' },
  { name: 'selected grant without award', id: 'zz_no_award', hasAward: false, distractorGrant: false },
  { name: 'no grant preserves original empty-selection behavior', id: 'cg_no_grant', hasGrant: false },
  { name: 'no caregiver preserves original empty-selection behavior', id: 'cg_no_caregiver', hasCaregiver: false }
];
for (const c of relationshipCases) test('restore relationships: ' + c.name, async () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON; CREATE TABLE caregiver(id TEXT PRIMARY KEY,first_name TEXT,last_name TEXT); CREATE TABLE grant_application(id INTEGER PRIMARY KEY,caregiver_id TEXT REFERENCES caregiver(id)); CREATE TABLE award(id INTEGER PRIMARY KEY,grant_application_id INTEGER REFERENCES grant_application(id)); CREATE TABLE followup(id INTEGER PRIMARY KEY,caregiver_id TEXT REFERENCES caregiver(id)); CREATE TABLE contact_history(id INTEGER PRIMARY KEY,caregiver_id TEXT REFERENCES caregiver(id)); CREATE TABLE note(id INTEGER PRIMARY KEY,caregiver_id TEXT REFERENCES caregiver(id)); CREATE TABLE audit_log(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,at TEXT);');
    const counts = c.counts || [2, 1, 3];
    const otherId = 'aa_other';
    if (c.hasCaregiver !== false) {
      database.prepare('INSERT INTO caregiver VALUES(?,?,?)').run(c.id, 'Synthetic', 'Target');
      database.prepare('INSERT INTO caregiver VALUES(?,?,?)').run(otherId, 'Synthetic', 'Distractor');
      if (c.hasGrant !== false) {
        database.prepare('INSERT INTO grant_application VALUES(?,?)').run(1, c.id);
        if (c.distractorGrant !== false) database.prepare('INSERT INTO grant_application VALUES(?,?)').run(2, otherId);
        if (c.hasAward !== false) database.prepare('INSERT INTO award VALUES(?,?)').run(1, 1);
      }
      for (const [index, table] of ['followup', 'contact_history', 'note'].entries()) {
        const insert = database.prepare('INSERT INTO ' + table + '(id,caregiver_id) VALUES(?,?)');
        for (let i = 0; i < counts[index]; i++) insert.run(i + 1, c.id);
        for (let i = 0; i < [3, 2, 4][index]; i++) insert.run(counts[index] + i + 1, otherId);
      }
    }
    database.prepare('INSERT INTO audit_log VALUES(?,?,?,?)').run(1, 'synthetic_staff', 'original', '2000-01-01T00:00:00Z');
    database.prepare('INSERT INTO audit_log VALUES(?,?,?,?)').run(2, 'synthetic_staff', 'prior', '2000-01-02T00:00:00Z');
    const snapshot = () => {
      const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
      const tables = Object.fromEntries(schema.filter(row => row.type === 'table').map(row => [
        row.name, database.prepare('SELECT * FROM "' + row.name + '" ORDER BY rowid').all()
      ]));
      return JSON.parse(JSON.stringify({ schema, tables, foreignKeys: database.prepare('PRAGMA foreign_keys').all() }));
    };
    const before = snapshot();
    const golden = ['followup', 'contact_history', 'note'].map(table =>
      database.prepare('SELECT COUNT(*) AS count FROM ' + table + ' WHERE caregiver_id=?').all(c.id)[0].count);
    const queries = [];
    const result = await spotCheckRelationships(async sql => {
      assert.match(sql.trim(), /^SELECT\b/i);
      assert.equal(sql.includes(';'), false, 'only single read-only SELECTs are permitted');
      queries.push(sql);
      return database.prepare(sql).all();
    });
    assert.deepEqual(snapshot(), before, 'complete schema, owner/distractor/audit rows and FK state unchanged');
    const selected = c.hasCaregiver !== false && c.hasGrant !== false;
    assert.deepEqual(result, {
      caregiverFound: selected,
      caregiverId: selected ? c.id : null,
      hasGrant: selected,
      grantId: selected ? 1 : null,
      hasAward: selected && c.hasAward !== false,
      awardId: selected && c.hasAward !== false ? 1 : null,
      followupCount: selected ? golden[0] : 0,
      contactHistoryCount: selected ? golden[1] : 0,
      noteCount: selected ? golden[2] : 0,
      auditLogPreserved: false,
      auditLogCount: 2
    });
    assert.equal(queries.length, selected ? 5 : 2);
    if (selected) assert.deepEqual(golden, counts);
  } finally { database.close(); }
});
