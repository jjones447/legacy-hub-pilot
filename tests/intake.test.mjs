// Slice 03 tests — real schema + intake core over node:sqlite via a thin D1 adapter.
// Run: node --test tests/
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleIntake, validateIntake } from '../functions/api/_shared.mjs';

const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');

// Minimal D1-shaped adapter over node:sqlite.
function d1(db) {
  return {
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
