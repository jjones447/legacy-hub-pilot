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
