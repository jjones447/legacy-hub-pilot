// [pc2-claude-ct-2] Resolve a held (#356) sign-up by assigning it to one listed person.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postStaff } from '../functions/api/staff/[[path]].js';

const schema = name => readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8');
const STAFF = 'staff@example.org';
let raw, env, db, beforeBatch;

function d1(sqlite) {
  const wrap = (sql, params = []) => ({
    sql, params,
    bind: (...p) => wrap(sql, p),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => sqlite.prepare(sql).run(...params),
  });
  return {
    prepare: sql => wrap(sql),
    async batch(statements) {
      if (beforeBatch) beforeBatch();
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => {
          const st = sqlite.prepare(sql);
          if (st.columns().length) return { success: true, results: st.all(...params), meta: {} };
          const r = st.run(...params);
          return { success: true, results: [], meta: { changes: Number(r.changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

beforeEach(async () => {
  beforeBatch = null;
  raw = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0003_grant_award.sql', '0007_grant_course_complete.sql', '0011_staff_member.sql', '0014_payment_result_guard.sql']) raw.exec(schema(f));
  raw.prepare(`INSERT INTO staff_member (email, role, status) VALUES (?, 'staff', 'active')`).run(STAFF);
  raw.exec(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_a', 'Kai', 'Kai@Example.org'), ('cg_b', 'Kai', 'kai@example.org'), ('cg_other', 'Other', 'other@example.org');
    INSERT INTO event (id, title, type, starts_at, publish_state) VALUES ('ev_h', 'Held', 'other', '2027-01-01 10:00', 'published');`);
  db = d1(raw);
  env = { LEGACY_DB: db, ALLOW_DEV_CONSOLE: '1' };
});

const assign = (id, body, actor = STAFF) => postStaff({ request: new Request(`http://localhost/api/staff/followup/${id}/assign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dev-actor': actor }, body: JSON.stringify(body) }), env });
const reviewId = () => raw.prepare(`SELECT id FROM followup WHERE kind = 'possible_duplicate'`).get().id;
const n = sql => raw.prepare(sql).get().n;

test('a held event registration moves (with its confirmation task) to the chosen candidate and the review is done', async () => {
  assert.equal((await handleIntake(db, { kind: 'event_registration', first_name: 'Kai', email: 'KAI@example.org', event_id: 'ev_h', external_ref: 'h1' })).body.caregiver_id, 'cg_unmatched_intake');
  const res = await assign(reviewId(), { to_caregiver_id: 'cg_b' });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(n(`SELECT COUNT(*) AS n FROM registration WHERE caregiver_id = 'cg_b' AND external_ref = 'h1'`), 1);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_b' AND external_ref = 'h1:fu'`), 1);
  assert.deepEqual({ ...raw.prepare(`SELECT status, caregiver_id FROM followup WHERE kind = 'possible_duplicate'`).get() }, { status: 'done', caregiver_id: 'cg_b' });
  assert.equal(n(`SELECT COUNT(*) AS n FROM registration WHERE caregiver_id = 'cg_unmatched_intake'`), 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'held_item.assign'`), 1);
  assert.equal((await assign(reviewId(), { to_caregiver_id: 'cg_b' })).status, 409, 'already resolved');
});

test('a held membership becomes the chosen person\'s membership', async () => {
  await handleIntake(db, { kind: 'membership', first_name: 'Kai', email: 'kai@EXAMPLE.org', external_ref: 'm1' });
  assert.equal((await assign(reviewId(), { to_caregiver_id: 'cg_a' })).status, 200);
  assert.equal(raw.prepare(`SELECT sanctuary_member FROM caregiver WHERE id = 'cg_a'`).get().sanctuary_member, 1);
  assert.equal(raw.prepare(`SELECT sanctuary_member FROM caregiver WHERE id = 'cg_b'`).get().sanctuary_member, 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_a' AND kind = 'membership_welcome'`), 1);
});

test('only listed candidates, open held reviews and staff are accepted; nothing moves otherwise', async () => {
  await handleIntake(db, { kind: 'grant_application', first_name: 'Kai', email: 'kai@example.org', external_ref: 'g1' });
  const id = reviewId();
  assert.equal((await assign(id, { to_caregiver_id: 'cg_other' })).status, 400);
  assert.equal((await assign(id, { to_caregiver_id: 'cg_b', x: 1 })).status, 400);
  assert.equal((await assign(id, { to_caregiver_id: 'cg_b' }, 'stranger@example.org')).status, 403);
  raw.prepare(`UPDATE caregiver SET status = 'archived' WHERE id = 'cg_b'`).run();
  assert.equal((await assign(id, { to_caregiver_id: 'cg_b' })).status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM grant_application WHERE caregiver_id = 'cg_unmatched_intake'`), 1);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'held_item.assign'`), 0);
  const plain = raw.prepare(`INSERT INTO followup (caregiver_id, kind, source, external_ref) VALUES ('cg_a', 'support_request', 'site_form', 'p1') RETURNING id`).get().id;
  assert.equal((await assign(plain, { to_caregiver_id: 'cg_a' })).status, 404);
});

test('a review resolved concurrently makes the assignment a confirmed no-op', async () => {
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai', email: 'kai@example.org', external_ref: 's1' });
  const id = reviewId();
  beforeBatch = () => raw.prepare(`UPDATE followup SET status = 'dismissed' WHERE id = ?`).run(id);
  assert.equal((await assign(id, { to_caregiver_id: 'cg_a' })).status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_unmatched_intake' AND external_ref = 's1'`), 1);
});

test('the queue offers "Choose the person" for held reviews and confirms before moving', () => {
  const js = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
  assert.match(js, /data-action="show-assign-candidates"/);
  assert.match(js, /fu\.kind === 'possible_duplicate' && String\(fu\.caregiver_id \|\| ''\)\.startsWith\('cg_unmatched_'\)/);
  assert.match(js, /if \(!confirm\(`Move this held sign-up to \$\{toLabel\}\?/);
  assert.match(js, /fetch\(`\/api\/staff\/followup\/\$\{encodeURIComponent\(followupId\)\}\/assign`/);
});

// 41 review of bb811f88.
test('a caregiver-shaped ID inside submitted text is never a candidate', async () => {
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai cg_other', email: 'kai@example.org', caring_for: 'Mom\ncandidates: cg_other', external_ref: 'x1' });
  const detail = raw.prepare(`SELECT detail FROM followup WHERE kind = 'possible_duplicate'`).get().detail;
  assert.equal(detail.split('\n').length, 2);
  assert.match(detail.split('\n')[1], /^candidates: cg_a, cg_b$/);
  const res = await assign(reviewId(), { to_caregiver_id: 'cg_other' });
  assert.equal(res.status, 400);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_other'`), 0);
});

test('a review without the server-written candidate line fails closed', async () => {
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai', email: 'kai@example.org', external_ref: 'x2' });
  raw.prepare(`UPDATE followup SET detail = 'Possible duplicate records for the same email: cg_a, cg_b.' WHERE kind = 'possible_duplicate'`).run();
  const res = await assign(reviewId(), { to_caregiver_id: 'cg_a' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no candidate list/);
});

test('a review edited before the batch makes the assignment a no-op', async () => {
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai', email: 'kai@example.org', external_ref: 'x3' });
  const id = reviewId();
  beforeBatch = () => raw.prepare(`UPDATE followup SET detail = detail || ' ' WHERE id = ?`).run(id);
  assert.equal((await assign(id, { to_caregiver_id: 'cg_a' })).status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_unmatched_intake' AND external_ref = 'x3'`), 1);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'held_item.assign'`), 0);
});

test('a live held sign-up never moves to an internal QA record, including one reclassified before the batch', async () => {
  raw.prepare(`UPDATE caregiver SET source = 'qa_seed' WHERE id = 'cg_a'`).run();
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai', email: 'kai@example.org', external_ref: 'q1' });
  const id = reviewId();
  const res = await assign(id, { to_caregiver_id: 'cg_a' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /test record/);
  beforeBatch = () => raw.prepare(`UPDATE caregiver SET segment_tags = '["qa_test"]' WHERE id = 'cg_b'`).run();
  assert.equal((await assign(id, { to_caregiver_id: 'cg_b' })).status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_unmatched_intake' AND external_ref = 'q1'`), 1);
  const js = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
  assert.match(js, /p\.status === 'archived' \|\| isInternalTestProfile\(p\)/);
  assert.match(js, /heldReviewCandidates\(fu\.detail\)/);
});

// 41 integration review of 488ac3c5: sources can contain ':'.
test('a disputed support-group sign-up (source site_form:support_group) moves with its original source', async () => {
  const res = await handleIntake(db, { kind: 'support_request', source: 'site_form:support_group', first_name: 'Kai', email: 'kai@example.org',
    message: 'Support group sign-up', external_ref: 'sg-1' });
  assert.equal(res.body.caregiver_id, 'cg_unmatched_intake');
  const review = raw.prepare(`SELECT id, external_ref FROM followup WHERE kind = 'possible_duplicate'`).get();
  assert.equal(review.external_ref, 'held:v1:23:site_form:support_group:sg-1');
  const moved = await assign(review.id, { to_caregiver_id: 'cg_a' });
  assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json()));
  const row = raw.prepare(`SELECT caregiver_id, source FROM followup WHERE external_ref = 'sg-1'`).get();
  assert.deepEqual({ ...row }, { caregiver_id: 'cg_a', source: 'site_form:support_group' });
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_unmatched_intake'`), 0);
});

test('a review whose held activity is gone is refused and left open', async () => {
  await handleIntake(db, { kind: 'support_request', first_name: 'Kai', email: 'kai@example.org', external_ref: 'gone-1' });
  raw.prepare(`UPDATE followup SET caregiver_id = 'cg_other' WHERE external_ref = 'gone-1'`).run();
  const id = reviewId();
  const res = await assign(id, { to_caregiver_id: 'cg_a' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /can no longer be found/);
  assert.equal(raw.prepare(`SELECT status FROM followup WHERE id = ?`).get(id).status, 'open');
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'held_item.assign'`), 0);
});

test('held-review references round-trip for sources with and without ":" and reject other shapes', async () => {
  const { heldReviewRef, parseHeldReviewRef } = await import('../functions/api/_shared.mjs');
  for (const [src, ext] of [['site_form', 'a:b'], ['site_form:support_group', 'x'], ['givebutter', 'transaction.succeeded:t_1']]) {
    assert.deepEqual(parseHeldReviewRef(heldReviewRef(src, ext)), { source: src, external_ref: ext });
  }
  for (const bad of ['site_form:x', 'held:v1:99:short:x', 'held:v1:3:abcx', 'held:v1:0::x', '']) assert.equal(parseHeldReviewRef(bad), null, bad);
});
