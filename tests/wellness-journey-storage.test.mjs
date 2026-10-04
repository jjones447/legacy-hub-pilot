// Synthetic in-memory SQLite schema tests, NOT workerd/D1 or authenticated endpoint acceptance.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = name => readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8');
const migration = schema('0013_wellness_journey.sql');
let db;
const staff = 'staff@example.invalid';
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = OFF;');
  for (const name of ['0001_init.sql', '0011_staff_member.sql', '0012_wellness_checkin.sql']) db.exec(schema(name));
  db.exec(migration);
  db.prepare('INSERT INTO staff_member(email) VALUES (?)').run(staff);
  db.exec("INSERT INTO caregiver(id, first_name) VALUES ('cg1', 'Fictional'), ('cg2', 'Synthetic')");
});
afterEach(() => db.close());
const count = table => Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n);
function questionnaire(version = 1, label = 'Example', id = 'demo') {
  return db.prepare('INSERT INTO journey_questionnaire(questionnaire_id, version, snapshot_json, created_by) VALUES (?, ?, ?, ?)')
    .run(id, version, JSON.stringify({ id, version, title: label, questions: [] }), staff);
}
function participation(state = 'selected', previous = null, owner = 'cg1', request = `select-${count('journey_participation')}`) {
  return Number(db.prepare('INSERT INTO journey_participation(caregiver_id, state, previous_id, request_id, changed_by) VALUES (?, ?, ?, ?, ?)')
    .run(owner, state, previous, request, staff).lastInsertRowid);
}
function period(selection, owner = 'cg1', version = 1, periodId = '2026-Q4') {
  return Number(db.prepare('INSERT INTO journey_period(caregiver_id, period_id, policy_json, participation_id, questionnaire_id, questionnaire_version, assigned_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(owner, periodId, JSON.stringify({ version: 1, schedule: 'calendar-quarter', timeZone: 'America/Chicago' }), selection, 'demo', version, staff).lastInsertRowid);
}
function response({ owner = 'cg1', kind = 'baseline', assignment = null, version = 1, request = `response-${count('journey_response')}`, answers = '{}' } = {}) {
  return db.prepare('INSERT INTO journey_response(caregiver_id, kind, period_assignment_id, questionnaire_id, questionnaire_version, answers_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(owner, kind, assignment, 'demo', version, answers, request);
}
function selectedPeriod() { questionnaire(); return period(participation()); }

test('additive migration is repeatable and does not enroll or change legacy observations', () => {
  db.exec("INSERT INTO wellness_checkin(caregiver_id, answers_json, score) VALUES ('cg1','{}',50)");
  const before = db.prepare('SELECT * FROM wellness_checkin').all();
  db.exec(migration);
  assert.deepEqual(db.prepare('SELECT * FROM wellness_checkin').all(), before);
  assert.equal(count('journey_participation'), 0);
  assert.equal(count('audit_log'), 0);
});
test('baseline is optional and does not require quarterly selection', () => {
  questionnaire(); response(); response({ request: 'second-baseline' });
  assert.equal(count('journey_response'), 2);
  assert.equal(count('journey_participation'), 0);
  const assignment = period(participation());
  response({ kind: 'quarterly', assignment });
  assert.equal(count('journey_response'), 3);
});
test('a quarterly response also succeeds without a baseline', () => {
  const assignment = selectedPeriod(); response({ kind: 'quarterly', assignment });
  assert.equal(count('journey_response'), 1);
});
test('versions retain original wording and response version after edits', () => {
  questionnaire(1, 'Original'); response({ answers: '{"example":1}' }); questionnaire(2, 'Revised');
  assert.equal(JSON.parse(db.prepare('SELECT snapshot_json FROM journey_questionnaire WHERE version=1').get().snapshot_json).title, 'Original');
  assert.equal(db.prepare('SELECT questionnaire_version FROM journey_response').get().questionnaire_version, 1);
});
test('withdrawal blocks collection without rewriting completed history; explicit re-selection restores participation', () => {
  const first = participation(); questionnaire(); const assignment = period(first);
  response({ kind: 'quarterly', assignment }); const second = participation('withdrawn', first);
  assert.throws(() => period(second, 'cg1', 1, '2027-Q1'), /current selection/);
  assert.equal(count('journey_response'), 1);
  const third = participation('selected', second);
  response({ kind: 'quarterly', assignment: period(third, 'cg1', 1, '2027-Q1') });
  assert.equal(count('journey_participation'), 3);
});
test('withdrawal after assignment denies a new quarterly submission', () => {
  questionnaire(); const selection = participation(); const assignment = period(selection);
  participation('withdrawn', selection);
  assert.throws(() => response({ kind: 'quarterly', assignment }), /current selection/);
  assert.equal(count('journey_response'), 0);
});
test('stale concurrent selection intent fails compare-and-append', () => {
  const first = participation(); participation('withdrawn', first);
  assert.throws(() => participation('selected', first), /stale participation/);
  assert.equal(count('journey_participation'), 2);
});
test('cannot withdraw a never-selected caregiver or repeat withdrawal', () => {
  assert.throws(() => participation('withdrawn'), /selection required/);
  const first = participation(); const second = participation('withdrawn', first);
  assert.throws(() => participation('withdrawn', second), /selection required/);
});
test('quarter assignment must reference current selection of the same owner', () => {
  questionnaire(); const first = participation(); participation('selected', null, 'cg2');
  assert.throws(() => period(first, 'cg2'), /current selection/);
  const second = participation('selected', first);
  assert.throws(() => period(first), /current selection/);
  period(second);
});
test('owner cannot submit to another caregiver assignment or change its questionnaire version', () => {
  const assignment = selectedPeriod(); questionnaire(2); participation('selected', null, 'cg2');
  assert.throws(() => response({ owner: 'cg2', kind: 'quarterly', assignment }), /FOREIGN KEY/);
  assert.throws(() => response({ kind: 'quarterly', assignment, version: 2 }), /FOREIGN KEY/);
});
test('duplicate quarter and same-key uncertain-ack retries cannot add responses or audits', () => {
  const assignment = selectedPeriod(); response({ kind: 'quarterly', assignment, request: 'same-id' });
  const audits = count('audit_log');
  assert.throws(() => response({ kind: 'quarterly', assignment, request: 'same-id' }), /already exists/);
  assert.throws(() => response({ kind: 'quarterly', assignment, request: 'different-id' }), /already exists/);
  assert.equal(count('journey_response'), 1); assert.equal(count('audit_log'), audits);
});
test('same request key is scoped to owner', () => {
  questionnaire(); response({ request: 'same-id' }); response({ owner: 'cg2', request: 'same-id' });
  assert.equal(count('journey_response'), 2);
});
test('duplicate participation and period cannot add audit entries', () => {
  questionnaire(); const selection = participation('selected', null, 'cg1', 'same-selection'); period(selection);
  const audits = count('audit_log');
  assert.throws(() => participation('selected', selection, 'cg1', 'same-selection'), /already exists/);
  assert.throws(() => period(selection), /already exists/);
  assert.equal(count('audit_log'), audits);
});
for (const status of ['inactive', 'archived']) test(`${status} caregivers cannot acquire selection, assignments or responses`, () => {
  const assignment = selectedPeriod(); db.prepare('UPDATE caregiver SET status=? WHERE id=?').run(status, 'cg1');
  assert.throws(() => participation('selected', 1), /active caregiver/);
  assert.throws(() => period(1, 'cg1', 1, '2027-Q1'), /active caregiver/);
  assert.throws(() => response(), /active caregiver/);
  assert.throws(() => response({ kind: 'quarterly', assignment }), /active caregiver/);
});
test('deactivated or nonexistent staff cannot author versions, selections or assignments', () => {
  questionnaire(); const selection = participation();
  db.prepare("UPDATE staff_member SET status='deactivated' WHERE email=?").run(staff);
  assert.throws(() => questionnaire(2), /active staff/);
  assert.throws(() => participation('selected', selection), /active staff/);
  assert.throws(() => period(selection), /active staff/);
  assert.throws(() => db.prepare("INSERT INTO journey_questionnaire VALUES ('missing',1,'{\"id\":\"missing\",\"version\":1}','nobody',datetime('now'))").run(), /active staff/);
});
for (const table of ['journey_questionnaire', 'journey_participation', 'journey_period', 'journey_response']) {
  test(`${table} rejects update/delete and replacement even with recursive triggers off`, () => {
    const assignment = selectedPeriod(); response({ kind: 'quarterly', assignment });
    const before = db.prepare(`SELECT * FROM ${table}`).all(); const audits = count('audit_log');
    assert.throws(() => db.exec(`UPDATE ${table} SET created_at='changed'`), /append-only/);
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /append-only/);
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /already exists/);
    assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before);
    assert.equal(count('audit_log'), audits);
  });
  test(`${table} and its audit insert fail atomically`, () => {
    let insert;
    if (table === 'journey_questionnaire') insert = () => questionnaire();
    if (table === 'journey_participation') insert = () => participation();
    if (table === 'journey_period') { questionnaire(); const selection = participation(); insert = () => period(selection); }
    if (table === 'journey_response') { questionnaire(); insert = () => response(); }
    const audits = count('audit_log');
    db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.entity='${table}' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;`);
    assert.throws(insert, /synthetic audit failure/);
    assert.equal(count(table), 0); assert.equal(count('audit_log'), audits);
  });
}
test('audit metadata does not duplicate answers, notes or questionnaire text', () => {
  questionnaire(1, 'private-synthetic-wording'); response({ answers: '{"example":"private-synthetic-answer"}' });
  const audits = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  assert.doesNotMatch(audits, /private-synthetic/);
  assert.match(audits, /journey.response/);
});
for (const answers of ['[]', 'null', 'false', '1', '"text"', '{']) test(`reject non-object/malformed answers ${answers}`, () => {
  questionnaire(); assert.throws(() => response({ answers })); assert.equal(count('journey_response'), 0);
});
test('questionnaire identity/version must match snapshot and version cannot be fractional', () => {
  for (const [version, snapshot] of [[1, '{}'], [1, '{"id":"other","version":1}'], [1, '{"id":"demo","version":"1"}'], [1.5, '{"id":"demo","version":1.5}']]) {
    assert.throws(() => db.prepare('INSERT INTO journey_questionnaire(questionnaire_id,version,snapshot_json,created_by) VALUES (?,?,?,?)').run('demo', version, snapshot, staff));
  }
});
test('kind/assignment shape, missing version and malformed quarter are rejected', () => {
  questionnaire(); const selection = participation();
  for (const periodId of ['0000-Q1', '9999-Q1', '2026-Q0', '2026-Q5', '2026-Q4extra']) assert.throws(() => period(selection, 'cg1', 1, periodId));
  const assignment = period(selection);
  assert.throws(() => response({ kind: 'baseline', assignment }), /CHECK/);
  assert.throws(() => response({ kind: 'quarterly' }), /CHECK/);
  assert.throws(() => response({ version: 99 }), /FOREIGN KEY/);
});
test('explicit caller transaction rollback preserves prior rows and audits', () => {
  questionnaire(); response({ request: 'preserved' }); const audits = count('audit_log');
  db.exec('BEGIN'); response({ request: 'rolled-back' }); db.exec('ROLLBACK');
  assert.equal(count('journey_response'), 1); assert.equal(count('audit_log'), audits);
  assert.equal(db.prepare('SELECT request_id FROM journey_response').get().request_id, 'preserved');
});
test('callers cannot inject participation sequence IDs to reorder history', () => {
  assert.throws(() => db.prepare('INSERT INTO journey_participation(id,caregiver_id,state,request_id,changed_by) VALUES (?,?,?,?,?)')
    .run(100, 'cg1', 'selected', 'injected', staff), /database assigned sequence/);
  assert.equal(count('journey_participation'), 0);
});
