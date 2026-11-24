// Synthetic Node SQLite + D1-shaped adapter, NOT real D1/workerd/authenticated endpoint proof.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readJourneyHistory, readSelectedJourneyParticipants } from '../functions/_lib/wellness-journey-history.js';
let sql, db, calls;
const staff = 'test@example.invalid';
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); calls = [];
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_init.sql', '0011_staff_member.sql', '0012_wellness_checkin.sql', 'candidates/0013_wellness_journey.sql']) {
    sql.exec(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8'));
  }
  sql.prepare('INSERT INTO staff_member(email) VALUES (?)').run(staff);
  sql.exec("INSERT INTO caregiver(id,first_name) VALUES ('cg1','Synthetic'),('cg2','Fictional'),('cg3','Example')");
  db = { prepare(query) {
    assert.match(query, /^SELECT/u);
    return { bind(...bindings) { calls.push({ query, bindings }); return { async all() {
      return { success: true, results: sql.prepare(query).all(...bindings) };
    } }; } };
  } };
  version(1, 'Original');
});
afterEach(() => sql.close());
function version(v, title) {
  sql.prepare('INSERT INTO journey_questionnaire(questionnaire_id,version,snapshot_json,created_by) VALUES (?,?,?,?)')
    .run('demo', v, JSON.stringify({ id: 'demo', version: v, title, questions: [] }), staff);
}
function select(owner = 'cg1', state = 'selected') {
  const previous = sql.prepare('SELECT MAX(id) id FROM journey_participation WHERE caregiver_id=?').get(owner).id;
  return Number(sql.prepare('INSERT INTO journey_participation(caregiver_id,state,previous_id,request_id,changed_by) VALUES (?,?,?,?,?)')
    .run(owner, state, previous, `p-${owner}-${previous}`, staff).lastInsertRowid);
}
function baseline(owner = 'cg1', v = 1, answers = '{}') {
  return Number(sql.prepare('INSERT INTO journey_response(caregiver_id,kind,questionnaire_id,questionnaire_version,answers_json,request_id) VALUES (?,\'baseline\',\'demo\',?,?,?)')
    .run(owner, v, answers, `r-${owner}-${sql.prepare('SELECT count(*) n FROM journey_response').get().n}`).lastInsertRowid);
}
function quarterly() {
  const selection = select();
  const assignment = Number(sql.prepare('INSERT INTO journey_period(caregiver_id,period_id,policy_json,participation_id,questionnaire_id,questionnaire_version,assigned_by) VALUES (\'cg1\',\'2026-Q4\',?, ?,\'demo\',1,?)')
    .run('{"version":1,"schedule":"calendar-quarter","timeZone":"America/Chicago"}', selection, staff).lastInsertRowid);
  sql.prepare('INSERT INTO journey_response(caregiver_id,kind,period_assignment_id,questionnaire_id,questionnaire_version,answers_json,request_id) VALUES (\'cg1\',\'quarterly\',?,\'demo\',1,\'{}\',\'quarterly\')').run(assignment);
}
test('history is owner-scoped and preserves exact questionnaire versions and answers', async () => {
  baseline('cg1', 1, '{"example":1}'); baseline('cg2'); version(2, 'Reworded'); baseline('cg1', 2);
  const { items, nextBeforeId } = await readJourneyHistory(db, 'cg1');
  assert.deepEqual(items.map(r => r.questionnaire.title), ['Reworded', 'Original']);
  assert.deepEqual(items[1].answers, { example: 1 }); assert.equal(nextBeforeId, null);
  assert.equal(items[0].period, null); assert.equal(items[0].kind, 'baseline');
  assert.deepEqual(Object.keys(items[0]).sort(), ['answers','createdAt','id','kind','period','questionnaire']);
});
test('quarter snapshots remain in history after withdrawal without satisfying baseline', async () => {
  baseline(); quarterly(); select('cg1', 'withdrawn');
  const result = await readJourneyHistory(db, 'cg1');
  assert.equal(result.items[0].period.id, '2026-Q4');
  assert.equal(result.items[0].period.policy.timeZone, 'America/Chicago');
  assert.equal(result.items[1].period, null);
});
test('sequence pagination is stable when a newer response arrives and skips other owners', async () => {
  const first = baseline(); baseline('cg2'); const second = baseline(); const third = baseline();
  const page = await readJourneyHistory(db, 'cg1', { limit: 1 });
  assert.equal(page.nextBeforeId, third); baseline();
  const rest = await readJourneyHistory(db, 'cg1', { beforeId: page.nextBeforeId, limit: 2 });
  assert.deepEqual(rest.items.map(r => r.id), [second, first]); assert.equal(rest.nextBeforeId, null);
});
test('inactive or archived owners are excluded without erasing prior history', async () => {
  baseline(); sql.exec("UPDATE caregiver SET status='archived' WHERE id='cg1'");
  assert.deepEqual((await readJourneyHistory(db, 'cg1')).items, []);
  assert.equal(sql.prepare('SELECT count(*) n FROM journey_response').get().n, 1);
});
test('selected list includes never-respondents, excludes withdrawn, permits explicit re-selection', async () => {
  select(); select('cg2'); select('cg2', 'withdrawn');
  assert.deepEqual((await readSelectedJourneyParticipants(db, staff)).items.map(r => r.caregiverId), ['cg1']);
  select('cg2'); assert.equal((await readSelectedJourneyParticipants(db, staff)).items.length, 2);
  assert.equal(sql.prepare('SELECT count(*) n FROM journey_response').get().n, 0);
});
test('participant pagination is bounded, identity ordered and contact-free', async () => {
  select('cg3'); select(); select('cg2');
  const page = await readSelectedJourneyParticipants(db, staff, { limit: 2 });
  assert.equal(page.nextAfterId, 'cg2');
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['caregiverId','selectedAt','selectionId']);
  const rest = await readSelectedJourneyParticipants(db, staff, { afterId: page.nextAfterId });
  assert.deepEqual(rest.items.map(r => r.caregiverId), ['cg3']); assert.equal(rest.nextAfterId, null);
});
test('missing/deactivated staff and inactive caregivers cannot appear in participant reads', async () => {
  select(); assert.deepEqual((await readSelectedJourneyParticipants(db, 'missing')).items, []);
  sql.prepare("UPDATE staff_member SET status='deactivated' WHERE email=?").run(staff);
  assert.deepEqual((await readSelectedJourneyParticipants(db, staff)).items, []);
  sql.prepare("UPDATE staff_member SET status='active' WHERE email=?").run(staff);
  sql.exec("UPDATE caregiver SET status='inactive' WHERE id='cg1'");
  assert.deepEqual((await readSelectedJourneyParticipants(db, staff)).items, []);
});
test('identities and cursors are bound, never interpolated into SQL', async () => {
  const injection = "' OR 1=1 --";
  baseline(); await readJourneyHistory(db, injection);
  await readSelectedJourneyParticipants(db, staff, { afterId: injection });
  for (const call of calls) assert.equal(call.query.includes(injection), false);
  assert.equal(calls[0].bindings[0], injection); assert.equal(calls[1].bindings[1], injection);
});
for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { beforeId: 0 }, { beforeId: '1' }, { extra: 1 }, [], null]) {
  test(`invalid history options reject before DB access ${JSON.stringify(options)}`, async () => {
    await assert.rejects(readJourneyHistory(db, 'cg1', options), TypeError); assert.equal(calls.length, 0);
  });
}
for (const id of ['', null, 123, 'a'.repeat(129), 'bad\nidentity']) test('invalid identity is rejected before DB access', async () => {
  await assert.rejects(readJourneyHistory(db, id), TypeError);
  await assert.rejects(readSelectedJourneyParticipants(db, id), TypeError); assert.equal(calls.length, 0);
});
test('participant cursors reject invalid types and unknown options', async () => {
  for (const options of [{ afterId: 1 }, { beforeId: 1 }, { limit: Infinity }]) await assert.rejects(readSelectedJourneyParticipants(db, staff, options), TypeError);
  assert.equal(calls.length, 0);
});
test('adapter failures and malformed results expose no SQL, identity or answer details', async () => {
  for (const broken of [null, { prepare() { throw new Error('secret SQL owner answers'); } },
    { prepare() { return { bind() { return { all: async () => ({ success: false, results: [] }) }; } }; } }]) {
    await assert.rejects(readJourneyHistory(broken, 'cg1'), { message: 'Journey read unavailable.' });
  }
});
function fake(row) { return { prepare() { return { bind() { return { all: async () => ({ success: true, results: [row] }) }; } }; } }; }
test('corrupt stored shapes and cross-owner adapter rows fail closed', async () => {
  baseline(); const valid = (await db.prepare(`SELECT r.*, q.snapshot_json, NULL assignment_id, NULL period_id, NULL policy_json FROM journey_response r JOIN journey_questionnaire q ON q.questionnaire_id=r.questionnaire_id`).bind().all()).results[0];
  for (const change of [{ caregiver_id: 'cg2' }, { answers_json: '[' }, { answers_json: '[]' }, { snapshot_json: '{"id":"wrong","version":1}' }, { id: 0 }, { kind: 'quarterly' }]) {
    await assert.rejects(readJourneyHistory(fake({ ...valid, ...change }), 'cg1'), { message: 'Journey history invalid.' });
  }
});
test('JSON per-row and page budgets are enforced without disclosing payloads', async () => {
  baseline('cg1', 1, JSON.stringify({ huge: 'x'.repeat(65536) }));
  await assert.rejects(readJourneyHistory(db, 'cg1'), { message: 'Journey history invalid.' });
});
test('read consumers never write audit/history or legacy observations', async () => {
  baseline(); select(); sql.exec("INSERT INTO wellness_checkin(caregiver_id,answers_json,score) VALUES ('cg1','{}',50)");
  const tables = ['journey_response','journey_participation','audit_log','wellness_checkin'];
  const before = tables.map(t => sql.prepare(`SELECT * FROM ${t}`).all());
  const result = await readJourneyHistory(db, 'cg1'); result.items[0].questionnaire.title = 'client mutation';
  await readSelectedJourneyParticipants(db, staff);
  assert.deepEqual(tables.map(t => sql.prepare(`SELECT * FROM ${t}`).all()), before);
  assert.equal((await readJourneyHistory(db, 'cg1')).items[0].questionnaire.title, 'Original');
});
test('aggregate JSON page budget rejects a page but a smaller page remains readable', async () => {
  for (let i = 0; i < 6; i++) baseline('cg1', 1, JSON.stringify({ example: 'x'.repeat(60000) }));
  await assert.rejects(readJourneyHistory(db, 'cg1'), { message: 'Journey history invalid.' });
  assert.equal((await readJourneyHistory(db, 'cg1', { limit: 2 })).items.length, 2);
});
test('duplicate, unordered and oversized adapter results fail closed', async () => {
  const row = { caregiver_id: 'cg1', selection_id: 1, created_at: '2026-10-04 00:00:00' };
  const adapter = results => ({ prepare() { return { bind() { return { all: async () => ({ success: true, results }) }; } }; } });
  await assert.rejects(readSelectedJourneyParticipants(adapter([row, row]), staff), { message: 'Journey participants invalid.' });
  await assert.rejects(readSelectedJourneyParticipants(adapter(Array(52).fill(row)), staff), { message: 'Journey read unavailable.' });
  await assert.rejects(readJourneyHistory(adapter({}), 'cg1'), { message: 'Journey read unavailable.' });
});
test('non-ASCII participant cursor uses SQLite binary ordering, not UTF-16 order', async () => {
  for (const id of ['\uE000', '\u{10000}']) {
    sql.prepare('INSERT INTO caregiver(id,first_name) VALUES (?,?)').run(id, 'Synthetic'); select(id);
  }
  const page = await readSelectedJourneyParticipants(db, staff, { limit: 1 });
  assert.equal(page.nextAfterId, '\uE000');
  assert.equal((await readSelectedJourneyParticipants(db, staff, { afterId: page.nextAfterId })).items[0].caregiverId, '\u{10000}');
});
