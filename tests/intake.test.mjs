// Slice 03 tests — real schema + intake core over node:sqlite via a thin D1 adapter.
// Run: node --test tests/
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleIntake, validateIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postIntake } from '../functions/api/intake.js';

const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');

// Minimal D1-shaped adapter over node:sqlite.
function d1(db) {
  return {
    batchCalls: 0,
    async batch(statements) {
      this.batchCalls++;
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push({ success: true, meta: await statement.run() });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return db.prepare(sql).get(...params) ?? null;
            },
            async run() {
              return db.prepare(sql).run(...params);
            },
          };
        },
        // support prepare().first() with no bind
        async first() {
          return db.prepare(sql).get() ?? null;
        },
      };
    },
  };
}

let raw, db;
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  raw
    .prepare(
      `INSERT INTO event (id, title, type, starts_at, capacity, publish_state)
       VALUES ('ev_test', 'Memory Social', 'memory_social', '2026-08-01 10:00', 2, 'published')`
    )
    .run();
  db = d1(raw);
});

test('migration applies clean: all nine tables exist', () => {
  const n = raw
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN
      ('caregiver','event','registration','grant_application','followup','note','content_item','content_type','audit_log')`)
    .get();
  assert.equal(n.n, 9);
});

test('validation rejects bad payloads', () => {
  assert.ok(validateIntake({}));
  assert.ok(validateIntake({ kind: 'nope', first_name: 'A', email: 'a@b.c', external_ref: 'x' }));
  assert.ok(validateIntake({ kind: 'membership', first_name: 'A', external_ref: 'x' })); // no contact
  assert.ok(validateIntake({ kind: 'event_registration', first_name: 'A', email: 'a@b.c', external_ref: 'x' })); // no event_id
  assert.equal(validateIntake({ kind: 'support_request', first_name: 'A', email: 'a@b.c', external_ref: 'x' }), null);
});

test('support_request creates caregiver + followup + audit row', async () => {
  const res = await handleIntake(db, {
    kind: 'support_request', first_name: 'Rita', email: 'rita@example.org',
    message: 'Need respite options', external_ref: 'uuid-1',
  });
  assert.equal(res.status, 201);
  const cg = raw.prepare(`SELECT * FROM caregiver WHERE email='rita@example.org'`).get();
  assert.ok(cg);
  const fu = raw.prepare(`SELECT * FROM followup WHERE caregiver_id=?`).get(cg.id);
  assert.equal(fu.kind, 'support_request');
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action='intake.support_request'`).get();
  assert.ok(audit);
});

test('duplicate (source, external_ref) is a no-op', async () => {
  const payload = {
    kind: 'support_request', first_name: 'Rita', email: 'rita@example.org',
    message: 'Need respite options', external_ref: 'uuid-dup',
  };
  const first = await handleIntake(db, payload);
  assert.equal(first.status, 201);
  const second = await handleIntake(db, payload);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  const n = raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get();
  assert.equal(n.n, 1);
});

test('membership sets sanctuary flag + welcome followup; existing caregiver reused', async () => {
  await handleIntake(db, {
    kind: 'support_request', first_name: 'Sam', email: 'sam@example.org',
    external_ref: 'uuid-2',
  });
  const res = await handleIntake(db, {
    kind: 'membership', first_name: 'Sam', email: 'sam@example.org',
    external_ref: 'uuid-3',
  });
  assert.equal(res.status, 201);
  const rows = raw.prepare(`SELECT COUNT(*) AS n FROM caregiver`).get();
  assert.equal(rows.n, 1); // upsert, not a second record
  const cg = raw.prepare(`SELECT * FROM caregiver WHERE email='sam@example.org'`).get();
  assert.equal(cg.sanctuary_member, 1);
  assert.ok(cg.member_since);
});

test('event registration writes registration + confirmation followup; capacity declines politely', async () => {
  const a = await handleIntake(db, {
    kind: 'event_registration', first_name: 'A', email: 'a@example.org',
    event_id: 'ev_test', external_ref: 'r1',
  });
  assert.equal(a.status, 201);
  const b = await handleIntake(db, {
    kind: 'event_registration', first_name: 'B', email: 'b@example.org',
    event_id: 'ev_test', external_ref: 'r2',
  });
  assert.equal(b.status, 201);
  const c = await handleIntake(db, {
    kind: 'event_registration', first_name: 'C', email: 'c@example.org',
    event_id: 'ev_test', external_ref: 'r3',
  });
  assert.equal(c.status, 409);
  assert.equal(c.body.error, 'event_full');
  const n = raw.prepare(`SELECT COUNT(*) AS n FROM registration`).get();
  assert.equal(n.n, 2);
});

test('unpublished event is not registerable', async () => {
  raw.prepare(`UPDATE event SET publish_state='draft' WHERE id='ev_test'`).run();
  const res = await handleIntake(db, {
    kind: 'event_registration', first_name: 'D', email: 'd@example.org',
    event_id: 'ev_test', external_ref: 'r4',
  });
  assert.equal(res.status, 404);
});

test('audit_log is append-only (UPDATE and DELETE abort)', async () => {
  await handleIntake(db, {
    kind: 'support_request', first_name: 'E', email: 'e@example.org', external_ref: 'r5',
  });
  assert.throws(() => raw.prepare(`UPDATE audit_log SET actor='tamper'`).run(), /append-only/);
  assert.throws(() => raw.prepare(`DELETE FROM audit_log`).run(), /append-only/);
});

// --- Per-IP request limit on POST /api/intake ---

function intakeRequest(body, ip) {
  return {
    headers: { get(name) { return name.toLowerCase() === 'cf-connecting-ip' ? ip : null; } },
    async json() { return body; },
  };
}

test('intake is limited to 10 requests per IP per 60 minutes', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await postIntake({
      request: intakeRequest({ kind: 'support_request', first_name: 'P', email: `p${i}@example.org`, external_ref: `ip-${i}` }, '203.0.113.8'),
      env: { LEGACY_DB: db },
    });
    assert.equal(res.status, 201, `request ${i + 1}`);
  }
  const blocked = await postIntake({
    request: intakeRequest({ kind: 'support_request', first_name: 'P', email: 'p11@example.org', external_ref: 'ip-11' }, '203.0.113.8'),
    env: { LEGACY_DB: db },
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'rate_limited');
  const written = raw.prepare(`SELECT COUNT(*) AS n FROM followup WHERE external_ref = 'ip-11'`).get();
  assert.equal(written.n, 0);

  const otherIp = await postIntake({
    request: intakeRequest({ kind: 'support_request', first_name: 'Q', email: 'q@example.org', external_ref: 'ip-other' }, '198.51.100.10'),
    env: { LEGACY_DB: db },
  });
  assert.equal(otherIp.status, 201);
});

test('intake fails closed with 503 when the request-limit store errors', async () => {
  const broken = { prepare() { throw new Error('store down'); } };
  const res = await postIntake({
    request: intakeRequest({ kind: 'support_request', first_name: 'R', email: 'r@example.org', external_ref: 'ip-e' }, '203.0.113.9'),
    env: { LEGACY_DB: broken },
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unavailable');
});

test('intake limiter stores only a hashed IP, never the raw address', async () => {
  const ip = '203.0.113.88';
  const res = await postIntake({
    request: intakeRequest({ kind: 'support_request', first_name: 'S', email: 's@example.org', external_ref: 'ip-f' }, ip),
    env: { LEGACY_DB: db },
  });
  assert.equal(res.status, 201);
  const leak = raw
    .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor LIKE ? OR IFNULL(entity_id, '') LIKE ? OR IFNULL(after_json, '') LIKE ?`)
    .get(`%${ip}%`, `%${ip}%`, `%${ip}%`);
  assert.equal(leak.n, 0);
  const hashed = raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'intake.submit_ip'`).get();
  assert.equal(hashed.n, 1);
});


test('membership intake handler retains the optional note in its welcome task, not audit or response', async () => {
  const message = 'Fictional note: group information only.\n<b>Text</b> & "quotes"; no contact requested.';
  const payload = {
    kind: 'membership', first_name: 'Demo', email: 'note-only@example.invalid',
    source: 'site_form:membership', external_ref: 'membership-note', message,
  };
  const res = await postIntake({ request: intakeRequest(payload, '203.0.113.21'), env: { LEGACY_DB: db } });
  assert.equal(res.status, 201);
  const response = await res.json();
  assert.equal(response.ok, true);
  assert.equal(JSON.stringify(response).includes(message), false);
  const task = raw.prepare(`SELECT * FROM followup WHERE caregiver_id = ?`).get(response.caregiver_id);
  assert.equal(task.kind, 'membership_welcome');
  assert.equal(task.status, 'open');
  assert.equal(task.detail, `Welcome new Sanctuary member\n\n${message}`);
  assert.equal(task.source, 'site_form:membership');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get().n, 1);
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'intake.membership'`).get();
  assert.deepEqual(JSON.parse(audit.after_json), {
    kind: 'membership', external_ref: 'membership-note', event_id: null,
  });
  assert.equal(JSON.stringify(raw.prepare(`SELECT * FROM audit_log`).all()).includes('Fictional note'), false);
});

test('membership without a substantive string note keeps the original welcome detail', async () => {
  for (const [index, message] of [undefined, '', ' \t\n ', null, 42, { note: 'not a form string' }].entries()) {
    const res = await handleIntake(db, {
      kind: 'membership', first_name: 'Demo', email: `blank-${index}@example.invalid`,
      external_ref: `membership-blank-${index}`, message,
    });
    assert.equal(res.status, 201);
    const task = raw.prepare(`SELECT detail FROM followup WHERE caregiver_id = ?`).get(res.body.caregiver_id);
    assert.equal(task.detail, 'Welcome new Sanctuary member');
  }
});

test('replayed membership with a changed note cannot replace or duplicate the original task', async () => {
  const payload = {
    kind: 'membership', first_name: 'Demo', email: 'repeat-note@example.invalid',
    source: 'site_form:membership', external_ref: 'membership-repeat-note',
    message: 'Original fictional note',
  };
  const first = await handleIntake(db, payload);
  assert.equal(first.status, 201);
  const task = raw.prepare(`SELECT * FROM followup`).get();
  assert.equal(task.detail, 'Welcome new Sanctuary member\n\nOriginal fictional note');
  const caregiver = raw.prepare(`SELECT * FROM caregiver`).get();
  const audits = raw.prepare(`SELECT * FROM audit_log ORDER BY id`).all();
  const repeated = await handleIntake(db, { ...payload, message: 'Replacement must not be saved' });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.duplicate, true);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get().n, 1);
  assert.deepEqual(raw.prepare(`SELECT * FROM followup`).get(), task);
  assert.deepEqual(raw.prepare(`SELECT * FROM caregiver`).get(), caregiver);
  assert.deepEqual(raw.prepare(`SELECT * FROM audit_log ORDER BY id`).all(), audits);
});

test('membership note does not overwrite an existing caregiver profile or membership date', async () => {
  raw.prepare(`INSERT INTO caregiver (id, first_name, last_name, email, phone, caring_for,
    relationship, sanctuary_member, member_since, source, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('cg_existing_note', 'Existing', 'Fictional', 'existing-note@example.invalid', '555-0100',
      'Original nonclinical value', 'Original relationship', 1, '2025-01-02 03:04:05',
      'original_source', 'inactive', '2025-01-02 03:04:05');
  const before = raw.prepare(`SELECT * FROM caregiver WHERE id = 'cg_existing_note'`).get();
  const res = await handleIntake(db, {
    kind: 'membership', first_name: 'Must not replace', last_name: 'Nor this',
    email: before.email, phone: '555-0199', caring_for: 'Not a profile update',
    source: 'site_form:membership', external_ref: 'membership-existing-note',
    message: 'Fictional follow-up note',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.caregiver_id, before.id);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM caregiver`).get().n, 1);
  const after = raw.prepare(`SELECT * FROM caregiver WHERE id = ?`).get(before.id);
  const { updated_at: oldTimestamp, ...originalProfile } = before;
  const { updated_at: newTimestamp, ...currentProfile } = after;
  assert.deepEqual(currentProfile, originalProfile);
  assert.notEqual(newTimestamp, oldTimestamp);
  assert.equal(raw.prepare(`SELECT detail FROM followup WHERE caregiver_id = ?`).get(before.id).detail,
    'Welcome new Sanctuary member\n\nFictional follow-up note');
});


function intakeSnapshot() {
  return Object.fromEntries(['caregiver', 'followup', 'audit_log'].map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}

function seedAtomicCaregiver() {
  raw.prepare(`INSERT INTO caregiver (id, first_name, last_name, email, status, source, sanctuary_member, member_since, updated_at)
    VALUES ('cg_atomic_existing', 'Existing', 'DEMO', 'atomic@example.invalid', 'inactive', 'original_demo', 0, NULL, '2020-01-02 03:04:05')`).run();
}

for (const kind of ['membership', 'support_request']) {
  for (const existing of [false, true]) {
    test(`${kind}: original audit failure after task rolls back ${existing ? 'existing inactive' : 'new'} caregiver and retry creates one complete chain`, async (t) => {
      if (existing) seedAtomicCaregiver();
      const before = intakeSnapshot();
      const ref = `atomic-${kind}-${existing ? 'existing' : 'new'}`;
      const payload = {kind,first_name:'Changed must not overwrite',email:'atomic@example.invalid',source:`site_form:${kind}`,external_ref:ref,message:'Fictional original note'};
      raw.exec(`CREATE TEMP TRIGGER fail_original_intake_audit BEFORE INSERT ON audit_log
        WHEN NEW.action = 'intake.${kind}' BEGIN
          SELECT CASE WHEN EXISTS (SELECT 1 FROM followup WHERE external_ref = '${ref}')
            THEN RAISE(ABORT, 'FICTIONAL_FAULT_AFTER_TASK') ELSE RAISE(ABORT, 'FAULT_BEFORE_TASK') END;
        END;`);
      await assert.rejects(handleIntake(db,payload),/FICTIONAL_FAULT_AFTER_TASK/);
      const afterFailure = intakeSnapshot();
      raw.exec('DROP TRIGGER fail_original_intake_audit');
      const retry = await handleIntake(db,payload);
      if (retry.body.duplicate) t.diagnostic(`PARTIAL_BASELINE: tasksAfterFault=${afterFailure.followup.length}, auditsAfterFault=${afterFailure.audit_log.length}, retry=${retry.status}/duplicate with no original audit`);
      assert.deepEqual(afterFailure,before,'audit failure must restore the entire pre-request business state');
      assert.equal(retry.status,201,'a rolled-back attempt cannot consume its key');
      const after = intakeSnapshot();
      assert.equal(after.caregiver.length,1);
      assert.equal(after.followup.length,1);
      assert.equal(after.audit_log.length,1);
      const caregiver = after.caregiver[0], task = after.followup[0], audit = after.audit_log[0];
      assert.equal(task.caregiver_id,caregiver.id);
      assert.equal(task.external_ref,ref);
      assert.equal(task.kind,kind==='membership'?'membership_welcome':'support_request');
      assert.equal(task.detail,kind==='membership'?'Welcome new Sanctuary member\n\nFictional original note':'Fictional original note');
      assert.equal(audit.entity,'caregiver');
      assert.equal(audit.entity_id,caregiver.id);
      assert.equal(audit.action,`intake.${kind}`);
      assert.equal(audit.actor,payload.source);
      assert.equal(JSON.parse(audit.after_json).external_ref,ref);
      if(existing) {
        assert.equal(caregiver.id,'cg_atomic_existing');
        assert.equal(caregiver.status,'inactive');
        assert.equal(caregiver.first_name,'Existing');
        assert.equal(caregiver.source,'original_demo');
      }
      const duplicate = await handleIntake(db,{...payload,message:'Must not replace the original'});
      assert.equal(duplicate.status,200);
      assert.equal(duplicate.body.duplicate,true);
      assert.deepEqual(intakeSnapshot(),after);
      assert.equal(db.batchCalls,2,'one failed and one healthy transaction, no duplicate transaction');
    });
  }

  test(`${kind}: task failure also rolls back existing caregiver timestamp and membership state`, async () => {
    seedAtomicCaregiver();
    const before=intakeSnapshot();
    raw.exec(`CREATE TEMP TRIGGER fail_intake_task BEFORE INSERT ON followup BEGIN SELECT RAISE(ABORT,'FICTIONAL_TASK_FAILURE'); END;`);
    await assert.rejects(handleIntake(db,{kind,first_name:'DEMO',email:'atomic@example.invalid',external_ref:`task-${kind}`}),/FICTIONAL_TASK_FAILURE/);
    assert.deepEqual(intakeSnapshot(),before);
  });
}

test('handler counts a failed attempt and later duplicate in IP limit while only healthy business writes commit', async () => {
  seedAtomicCaregiver();
  const payload={kind:'membership',first_name:'DEMO',email:'atomic@example.invalid',external_ref:'atomic-http',source:'site_form:membership',message:'Fictional note'};
  raw.exec(`CREATE TEMP TRIGGER fail_http_intake_audit BEFORE INSERT ON audit_log WHEN NEW.action='intake.membership' BEGIN SELECT RAISE(ABORT,'FICTIONAL_HTTP_AUDIT_FAILURE'); END;`);
  await assert.rejects(postIntake({request:intakeRequest(payload,'203.0.113.90'),env:{LEGACY_DB:db}}),/FICTIONAL_HTTP_AUDIT_FAILURE/);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM followup').get().n,0);
  assert.equal(raw.prepare(`SELECT sanctuary_member FROM caregiver WHERE id='cg_atomic_existing'`).get().sanctuary_member,0);
  raw.exec('DROP TRIGGER fail_http_intake_audit');
  const healthy=await postIntake({request:intakeRequest(payload,'203.0.113.90'),env:{LEGACY_DB:db}});
  assert.equal(healthy.status,201);
  const duplicate=await postIntake({request:intakeRequest(payload,'203.0.113.90'),env:{LEGACY_DB:db}});
  assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action='intake.submit_ip'`).get().n,3);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action='intake.membership'`).get().n,1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM followup').get().n,1);
});

test('historical partial task remains a duplicate without manufactured audit or profile repair', async () => {
  seedAtomicCaregiver();
  raw.prepare(`INSERT INTO followup (caregiver_id,kind,source,external_ref) VALUES ('cg_atomic_existing','support_request','site_form:support','historical-partial')`).run();
  const before=intakeSnapshot();
  const duplicate=await handleIntake(db,{kind:'support_request',first_name:'DEMO',email:'atomic@example.invalid',source:'site_form:support',external_ref:'historical-partial'});
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);
  assert.deepEqual(intakeSnapshot(),before);assert.equal(db.batchCalls,0);
});


test('lost acknowledgement after a committed intake batch leaves one complete chain for duplicate readback', async () => {
  const originalBatch=db.batch.bind(db);
  db.batch=async statements => {await originalBatch(statements);throw new Error('FICTIONAL_COMMITTED_ACK_LOST');};
  const payload={kind:'support_request',first_name:'DEMO',email:'ack@example.invalid',source:'site_form:support_group',external_ref:'atomic-ack',message:'Fictional support-group interest'};
  await assert.rejects(handleIntake(db,payload),/FICTIONAL_COMMITTED_ACK_LOST/);
  const committed=intakeSnapshot();
  assert.equal(committed.caregiver.length,1);assert.equal(committed.followup.length,1);assert.equal(committed.audit_log.length,1);
  db.batch=originalBatch;
  const duplicate=await handleIntake(db,payload);
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);
  assert.deepEqual(intakeSnapshot(),committed);
});

test('unqualified batch acknowledgement fails without a sequential-write fallback or success response', async () => {
  const before=intakeSnapshot();
  for(const result of [undefined,[],[{success:false}],Array(3).fill({success:true})]) {
    const broken={...db,batch:async()=>result};
    await assert.rejects(handleIntake(broken,{kind:'membership',first_name:'DEMO',email:'unqualified@example.invalid',external_ref:'unqualified'}),/intake batch did not confirm all mutations/);
    assert.deepEqual(intakeSnapshot(),before);
  }
});

// Oct 26 request: the support-group joining link is returned only for a confirmed
// support-group capture, never for other forms, kinds or failed saves.
const SUPPORT_GROUP_LINK = 'https://meet.google.com/dmc-orwi-afk';
const supportGroupPayload = (ref) => ({
  kind: 'support_request', source: 'site_form:support_group', first_name: 'Demo',
  email: 'group@example.invalid', message: 'Virtual support group', external_ref: ref,
});

test('support-group capture returns the joining link only after the atomic save, and again on its duplicate', async () => {
  const first = await handleIntake(db, supportGroupPayload('sg-1'));
  assert.equal(first.status, 201);
  assert.equal(first.body.join_url, SUPPORT_GROUP_LINK);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup WHERE source = 'site_form:support_group'`).get().n, 1);
  const again = await handleIntake(db, supportGroupPayload('sg-1'));
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.join_url, SUPPORT_GROUP_LINK);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get().n, 1);
});

test('no joining link for other sources, other kinds or an invalid request', async () => {
  for (const body of [
    { ...supportGroupPayload('sg-2'), source: 'site_form:support' },
    { ...supportGroupPayload('sg-3'), source: 'site_form:coaching' },
    { ...supportGroupPayload('sg-4'), source: undefined },
    { ...supportGroupPayload('sg-5'), kind: 'membership' },
  ]) {
    const res = await handleIntake(db, body);
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res));
    assert.equal(res.body.join_url, undefined, body.source + '/' + body.kind);
  }
  const invalid = await handleIntake(db, { ...supportGroupPayload('sg-6'), email: undefined });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.join_url, undefined);
});

test('a support-group save that does not confirm returns no joining link', async () => {
  db.batch = async () => [{ success: true }];  // batch reports fewer confirmed writes than requested
  await assert.rejects(() => handleIntake(db, supportGroupPayload('sg-7')), /did not confirm/);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get().n, 0);
});
