// [pc2-claude-ct-2] Staff "merge duplicate records" (requester, Nov 12 2026, ts 1794499371.807299).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost as postStaff } from '../functions/api/staff/[[path]].js';

const schema = name => readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8');
const STAFF = 'staff@example.org';
let raw, env, beforeBatch;

function d1(db) {
  const wrap = (sql, params = []) => ({
    sql, params,
    bind: (...p) => wrap(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => db.prepare(sql).run(...params),
  });
  return {
    prepare: sql => wrap(sql),
    async batch(statements) {
      if (beforeBatch) beforeBatch();
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => {
          const st = db.prepare(sql);
          if (st.columns().length) return { success: true, results: st.all(...params), meta: {} };
          const r = st.run(...params);
          return { success: true, results: [], meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

beforeEach(() => {
  beforeBatch = null;
  raw = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0003_grant_award.sql', '0005_portal_login.sql', '0006_caregiver_contact_history_outcomes.sql',
    '0007_grant_course_complete.sql', '0011_staff_member.sql', '0012_wellness_checkin.sql', '0014_payment_result_guard.sql']) raw.exec(schema(f));
  raw.prepare(`INSERT INTO staff_member (email, role, status) VALUES (?, 'staff', 'active')`).run(STAFF);
  raw.exec(`INSERT INTO caregiver (id, first_name, email, segment_tags) VALUES ('cg_keep', 'Jane', 'jane@example.org', '["dementia"]');
    INSERT INTO caregiver (id, first_name, last_name, email, phone, sanctuary_member, member_since, donor, caring_for, segment_tags)
      VALUES ('cg_dup', 'Jane', 'Doe', 'Jane.Doe@Work.example', '555-0100', 1, '2026-10-01 00:00:00', 1, 'Mother', '["dementia","als"]');
    INSERT INTO event (id, title, type, starts_at, publish_state) VALUES ('ev_m', 'Merge test', 'other', '2026-12-01 10:00', 'published');
    INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES ('cg_dup', 'ev_m', 'site_form', 'r1');
    INSERT INTO followup (caregiver_id, kind, source, external_ref) VALUES ('cg_dup', 'support_request', 'site_form', 'f1');
    INSERT INTO grant_application (caregiver_id, status, source, external_ref) VALUES ('cg_dup', 'submitted', 'site_form', 'g1');
    INSERT INTO note (caregiver_id, author, body) VALUES ('cg_dup', 'staff', 'Older note');
    INSERT INTO contact_history (caregiver_id, occurred_at, channel, direction, summary, recorded_by) VALUES ('cg_dup', '2026-11-01', 'phone', 'inbound', 'Called', 'staff');
    INSERT INTO wellness_checkin (caregiver_id, answers_json, score) VALUES ('cg_dup', '{}', 70);
    INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES ('t1', 'cg_dup', '2099-01-01 00:00:00', 0);`);
  env = { LEGACY_DB: d1(raw), ALLOW_DEV_CONSOLE: '1' };
});

const merge = (keep, body, actor = STAFF) => postStaff({ request: new Request(`http://localhost/api/staff/caregiver/${keep}/merge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dev-actor': actor }, body: JSON.stringify(body) }), env });
const n = sql => raw.prepare(sql).get().n;

test('merging moves every linked item, fills only empty fields, archives the duplicate and audits once', async () => {
  const res = await merge('cg_keep', { from_id: 'cg_dup' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.moved, { registration: 1, grant_application: 1, followup: 1, note: 1, contact_history: 1, wellness_checkin: 1 });
  for (const t of ['registration', 'grant_application', 'followup', 'contact_history', 'wellness_checkin']) {
    assert.equal(n(`SELECT COUNT(*) AS n FROM ${t} WHERE caregiver_id = 'cg_dup'`), 0, t);
    assert.equal(n(`SELECT COUNT(*) AS n FROM ${t} WHERE caregiver_id = 'cg_keep'`), 1, t);
  }
  const keep = raw.prepare(`SELECT * FROM caregiver WHERE id = 'cg_keep'`).get();
  assert.equal(keep.email, 'jane@example.org', 'kept email is never overwritten');
  assert.equal(keep.last_name, 'Doe');
  assert.equal(keep.phone, '555-0100');
  assert.equal(keep.caring_for, 'Mother');
  assert.equal(keep.sanctuary_member, 1);
  assert.equal(keep.member_since, '2026-10-01 00:00:00');
  assert.equal(keep.donor, 1);
  assert.deepEqual(JSON.parse(keep.segment_tags), ['dementia', 'als']);
  assert.equal(raw.prepare(`SELECT status FROM caregiver WHERE id = 'cg_dup'`).get().status, 'archived');
  assert.equal(raw.prepare(`SELECT used FROM portal_token WHERE token_hash = 't1'`).get().used, 1);
  const audits = raw.prepare(`SELECT actor, entity_id, after_json FROM audit_log WHERE action = 'caregiver.merge'`).all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, STAFF);
  assert.match(audits[0].after_json, /"from_id":"cg_dup"/);
  const note = raw.prepare(`SELECT body FROM note WHERE caregiver_id = 'cg_keep' AND body LIKE 'Merged duplicate record%'`).get();
  assert.match(note.body, /cg_dup \(Jane Doe <Jane\.Doe@Work\.example> \/ 555-0100\)/);
  // A second attempt is refused: the duplicate is archived.
  assert.equal((await merge('cg_keep', { from_id: 'cg_dup' })).status, 409);
});

test('merges are refused for the same record, holding records, archived records, unknown fields and non-staff', async () => {
  assert.equal((await merge('cg_keep', { from_id: 'cg_keep' })).status, 400);
  raw.prepare(`INSERT INTO caregiver (id, first_name, status) VALUES ('cg_unmatched_intake', 'Unmatched', 'inactive')`).run();
  assert.equal((await merge('cg_keep', { from_id: 'cg_unmatched_intake' })).status, 400);
  assert.equal((await merge('cg_keep', { from_id: 'cg_dup', extra: 1 })).status, 400);
  assert.equal((await merge('cg_keep', { from_id: 'cg_dup' }, 'stranger@example.org')).status, 403);
  raw.prepare(`UPDATE caregiver SET status = 'archived' WHERE id = 'cg_dup'`).run();
  assert.equal((await merge('cg_keep', { from_id: 'cg_dup' })).status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'caregiver.merge'`), 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_keep'`), 0);
});

test('if a record is archived between checking and merging, nothing is merged', async () => {
  beforeBatch = () => raw.prepare(`UPDATE caregiver SET status = 'archived' WHERE id = 'cg_keep'`).run();
  const res = await merge('cg_keep', { from_id: 'cg_dup' });
  assert.equal(res.status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_dup'`), 1);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'caregiver.merge'`), 0);
  assert.equal(n(`SELECT COUNT(*) AS n FROM note WHERE body LIKE 'Merged duplicate%'`), 0);
  assert.equal(raw.prepare(`SELECT status FROM caregiver WHERE id = 'cg_dup'`).get().status, 'active');
  assert.equal(raw.prepare(`SELECT used FROM portal_token WHERE token_hash = 't1'`).get().used, 0);
});

test('the person record offers Find + confirm-before-merge, never for holding or archived records', () => {
  const js = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
  assert.match(js, /<details class="mt-16" id="caregiverMergeDetails">/);
  assert.match(js, /data-action="find-merge-duplicates"/);
  assert.match(js, /cg\.id !== keepId && cg\.status !== 'archived' && !String\(cg\.id\)\.startsWith\('cg_unmatched_'\)/);
  assert.match(js, /if \(!confirm\(`Merge \$\{fromLabel\} into this record\?/);
  assert.match(js, /fetch\(`\/api\/staff\/caregiver\/\$\{encodeURIComponent\(keepId\)\}\/merge`/);
});

// 41 review of #361.
test('a live record and an internal-QA record never merge, in either direction', async () => {
  raw.prepare(`INSERT INTO caregiver (id, first_name, email, source) VALUES ('cg_qa_src', 'QA', 'qa1@example.invalid', 'qa_seed')`).run();
  raw.prepare(`INSERT INTO caregiver (id, first_name, email, segment_tags) VALUES ('cg_qa_tag', 'QA', 'qa2@example.invalid', '["qa_test"]')`).run();
  for (const [keep, from] of [['cg_keep', 'cg_qa_src'], ['cg_qa_tag', 'cg_dup'], ['cg_qa_src', 'cg_keep']]) {
    const res = await merge(keep, { from_id: from });
    assert.equal(res.status, 409, `${keep} <- ${from}`);
    assert.match((await res.json()).error, /test record and a live record/);
  }
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'caregiver.merge'`), 0);
  // Two QA records may merge with each other.
  assert.equal((await merge('cg_qa_src', { from_id: 'cg_qa_tag' })).status, 200);
});

test('a concurrent tag edit on the kept record makes the merge a confirmed no-op (no overwrite)', async () => {
  beforeBatch = () => raw.prepare(`UPDATE caregiver SET segment_tags = '["stroke"]' WHERE id = 'cg_keep'`).run();
  const res = await merge('cg_keep', { from_id: 'cg_dup' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Nothing was merged/);
  assert.equal(raw.prepare(`SELECT segment_tags FROM caregiver WHERE id = 'cg_keep'`).get().segment_tags, '["stroke"]');
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_dup'`), 1);
  assert.equal(n(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'caregiver.merge'`), 0);
});

test('a new linked item on the duplicate between read and write makes the merge a confirmed no-op', async () => {
  beforeBatch = () => raw.prepare(`INSERT INTO followup (caregiver_id, kind, source, external_ref) VALUES ('cg_dup', 'support_request', 'site_form', 'f2')`).run();
  const res = await merge('cg_keep', { from_id: 'cg_dup' });
  assert.equal(res.status, 409);
  assert.equal(n(`SELECT COUNT(*) AS n FROM followup WHERE caregiver_id = 'cg_dup'`), 2);
  assert.equal(n(`SELECT COUNT(*) AS n FROM note WHERE body LIKE 'Merged duplicate%'`), 0);
  assert.equal(raw.prepare(`SELECT status FROM caregiver WHERE id = 'cg_dup'`).get().status, 'active');
});

test('an incomplete batch receipt is reported as unconfirmed, not as "nothing was merged"', async () => {
  const realBatch = env.LEGACY_DB.batch.bind(env.LEGACY_DB);
  env.LEGACY_DB.batch = async statements => (await realBatch(statements)).slice(0, -1);
  const res = await merge('cg_keep', { from_id: 'cg_dup' });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /could not be confirmed/);
  assert.doesNotMatch(body.error, /Nothing was merged/);
});
