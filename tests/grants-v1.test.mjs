// Slice 06 tests — Grants v1 dynamic APIs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleIntake, validateIntake } from '../functions/api/_shared.mjs';
import { onRequestGet as getGrants, onRequestPost as postGrants } from '../functions/api/grants/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');

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
            async all() {
              return { results: db.prepare(sql).all(...params) };
            }
          };
        },
        async first() {
          return db.prepare(sql).get() ?? null;
        },
        async run() {
          return db.prepare(sql).run();
        },
        async all() {
          return { results: db.prepare(sql).all() };
        }
      };
    }
  };
}

let raw;
let env;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  env = { LEGACY_DB: d1(raw) };
});

test('intake of grant_application kind creates caregiver, grant_application, followup, and audit', async () => {
  const db = d1(raw);
  const res = await handleIntake(db, {
    kind: 'grant_application',
    first_name: 'Jane',
    email: 'jane@example.org',
    requested_for: 'Respite care assistance',
    external_ref: 'ext-grant-1',
    source: 'site_form'
  });

  assert.equal(res.status, 201);
  const cg = raw.prepare(`SELECT * FROM caregiver WHERE email = 'jane@example.org'`).get();
  assert.ok(cg);

  const app = raw.prepare(`SELECT * FROM grant_application WHERE caregiver_id = ?`).get(cg.id);
  assert.ok(app);
  assert.equal(app.status, 'submitted');
  assert.equal(app.requested_for, 'Respite care assistance');

  const fu = raw.prepare(`SELECT * FROM followup WHERE caregiver_id = ?`).get(cg.id);
  assert.ok(fu);
  assert.equal(fu.kind, 'grant_review');
  assert.equal(fu.detail, 'New wellness-grant application');

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'intake.grant_application'`).get();
  assert.ok(audit);
});

test('intake of grant_application is idempotent', async () => {
  const db = d1(raw);
  const payload = {
    kind: 'grant_application',
    first_name: 'Jane',
    email: 'jane@example.org',
    requested_for: 'Respite care assistance',
    external_ref: 'ext-grant-dup',
    source: 'site_form'
  };

  const first = await handleIntake(db, payload);
  assert.equal(first.status, 201);

  const second = await handleIntake(db, payload);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);

  const count = raw.prepare(`SELECT COUNT(*) AS n FROM grant_application`).get();
  assert.equal(count.n, 2); // 1 from seed + 1 from first handleIntake
});

test('GET /api/grants returns list of applications with caregiver and award info', async () => {
  // Jane is already seeded from schema/0003_grant_award.sql (id=1001)
  const res = await getGrants({ request: new Request('http://localhost/api/grants'), env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.grants.length, 1);
  assert.equal(data.grants[0].caregiver_first_name, 'Jane');
  assert.equal(data.grants[0].status, 'submitted');
});

test('GET /api/grants?status=in_review filters results', async () => {
  // Let's change status of seed to in_review
  raw.prepare(`UPDATE grant_application SET status = 'in_review' WHERE id = 1001`).run();
  
  const resEmpty = await getGrants({ request: new Request('http://localhost/api/grants?status=submitted'), env });
  assert.equal(resEmpty.status, 200);
  const dataEmpty = await resEmpty.json();
  assert.equal(dataEmpty.grants.length, 0);

  const resMatch = await getGrants({ request: new Request('http://localhost/api/grants?status=in_review'), env });
  assert.equal(resMatch.status, 200);
  const dataMatch = await resMatch.json();
  assert.equal(dataMatch.grants.length, 1);
});

test('workflow transition: submitted -> in_review -> awarded -> closed', async () => {
  // 1. review
  const reqReview = new Request('http://localhost/api/grants/1001/review', {
    method: 'POST',
    body: JSON.stringify({ review_notes: 'Checking credentials' })
  });
  const resReview = await postGrants({ request: reqReview, env });
  assert.equal(resReview.status, 200);

  const appReview = raw.prepare(`SELECT status, review_notes FROM grant_application WHERE id = 1001`).get();
  assert.equal(appReview.status, 'in_review');
  assert.equal(appReview.review_notes, 'Checking credentials');

  // 2. decision: awarded
  const reqDecision = new Request('http://localhost/api/grants/1001/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'awarded', amount: '$500', care_package: 'Package A' })
  });
  const resDecision = await postGrants({ request: reqDecision, env });
  assert.equal(resDecision.status, 200);

  const appDecision = raw.prepare(`SELECT status FROM grant_application WHERE id = 1001`).get();
  assert.equal(appDecision.status, 'awarded');

  const award = raw.prepare(`SELECT * FROM award WHERE grant_application_id = 1001`).get();
  assert.ok(award);
  assert.equal(award.amount, '$500');
  assert.equal(award.care_package, 'Package A');

  const followup = raw.prepare(`SELECT * FROM followup WHERE caregiver_id = 'cg_seed_fictional' AND kind = 'grant_award_delivery'`).get();
  assert.ok(followup);
  assert.equal(followup.detail, 'Deliver care package');

  // 3. close
  const reqClose = new Request('http://localhost/api/grants/1001/close', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'Delivered caregiver respite' })
  });
  const resClose = await postGrants({ request: reqClose, env });
  assert.equal(resClose.status, 200);

  const appClosed = raw.prepare(`SELECT status FROM grant_application WHERE id = 1001`).get();
  assert.equal(appClosed.status, 'closed');

  const awardClosed = raw.prepare(`SELECT outcome FROM award WHERE grant_application_id = 1001`).get();
  assert.equal(awardClosed.outcome, 'Delivered caregiver respite');
});

test('workflow rejects illegal transitions with 409', async () => {
  // Seed starts at 'submitted'. Trying to close directly should fail.
  const reqClose = new Request('http://localhost/api/grants/1001/close', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'Failed' })
  });
  const resClose = await postGrants({ request: reqClose, env });
  assert.equal(resClose.status, 409);

  // Trying to decide directly from submitted should fail.
  const reqDecision = new Request('http://localhost/api/grants/1001/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'awarded' })
  });
  const resDecision = await postGrants({ request: reqDecision, env });
  assert.equal(resDecision.status, 409);
});
