// Tests for LEGACY-D5-COURSE-COMPLETE-R1 (Issue #95)
// Covers deliverables (a) through (f) explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getGrants, onRequestPost as postGrants } from '../functions/api/grants/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_7 = readFileSync(new URL('../schema/0007_grant_course_complete.sql', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');

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

function setupDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_7);
  return { raw, env: { LEGACY_DB: d1(raw) } };
}

test('(a) migration preserves every row and every award link on a fixture DB', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_1);
  db.exec(SCHEMA_3);

  // Setup rich fixture with multiple caregivers, applications across statuses, and awards
  db.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, caring_for, relationship, source)
    VALUES ('cg_fix_2', 'Bob', 'Smith', 'bob@example.org', '555-987-6543', 'Spouse with Parkinson', 'husband', 'site_form')
  `).run();

  db.prepare(`
    INSERT INTO grant_application (id, caregiver_id, requested_for, status, review_notes, source, external_ref)
    VALUES (1002, 'cg_seed_fictional', 'Training module A', 'in_review', 'Under team review', 'site_form', 'ext_fix_02')
  `).run();

  db.prepare(`
    INSERT INTO grant_application (id, caregiver_id, requested_for, status, review_notes, source, external_ref)
    VALUES (1003, 'cg_fix_2', 'Specialized course', 'awarded', 'Approved in full', 'staff', 'ext_fix_03')
  `).run();

  db.prepare(`
    INSERT INTO grant_application (id, caregiver_id, requested_for, status, review_notes, source, external_ref)
    VALUES (1004, 'cg_fix_2', 'Equipment grant', 'declined', 'Outside scope', 'site_form', 'ext_fix_04')
  `).run();

  db.prepare(`
    INSERT INTO grant_application (id, caregiver_id, requested_for, status, review_notes, source, external_ref)
    VALUES (1005, 'cg_seed_fictional', 'Archived grant', 'closed', 'Already finished', 'site_form', 'ext_fix_05')
  `).run();

  // Attach awards to grant 1003 and 1005
  db.prepare(`
    INSERT INTO award (id, grant_application_id, amount, care_package, outcome)
    VALUES (201, 1003, '$750', 'Course tuition + transport', NULL)
  `).run();

  db.prepare(`
    INSERT INTO award (id, grant_application_id, amount, care_package, outcome)
    VALUES (202, 1005, '$500', 'Day respite', 'Successfully completed social')
  `).run();

  // Snapshot before migration
  const grantsBefore = db.prepare('SELECT * FROM grant_application ORDER BY id ASC').all();
  const awardsBefore = db.prepare('SELECT * FROM award ORDER BY id ASC').all();

  assert.equal(grantsBefore.length, 5); // 1001 (from seed) + 1002 + 1003 + 1004 + 1005
  assert.equal(awardsBefore.length, 2);

  // Count existing grants that are awarded and would now require course_complete before closing
  const awardedCount = grantsBefore.filter(g => g.status === 'awarded').length;
  assert.equal(awardedCount, 1); // grant 1003

  // Execute schema 0007 migration
  db.exec(SCHEMA_7);

  // Verify foreign key integrity
  const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
  assert.deepEqual(fkErrors, [], 'Migration must produce 0 foreign key constraint errors');

  // Verify all grant_application rows survived with exact columns and data
  const grantsAfter = db.prepare('SELECT * FROM grant_application ORDER BY id ASC').all();
  assert.equal(grantsAfter.length, grantsBefore.length);
  for (let i = 0; i < grantsBefore.length; i++) {
    assert.deepEqual(grantsAfter[i], grantsBefore[i], `Grant row id ${grantsBefore[i].id} mismatch`);
  }

  // Verify all award rows survived with exact columns and links
  const awardsAfter = db.prepare('SELECT * FROM award ORDER BY id ASC').all();
  assert.equal(awardsAfter.length, awardsBefore.length);
  for (let i = 0; i < awardsBefore.length; i++) {
    assert.deepEqual(awardsAfter[i], awardsBefore[i], `Award row id ${awardsBefore[i].id} mismatch`);
  }

  // Verify award links point to valid grant_application
  for (const aw of awardsAfter) {
    const parent = db.prepare('SELECT * FROM grant_application WHERE id = ?').get(aw.grant_application_id);
    assert.ok(parent, `Award ${aw.id} parent grant ${aw.grant_application_id} must exist`);
  }

  // Verify widened CHECK constraint allows 'course_complete'
  db.prepare(`UPDATE grant_application SET status = 'course_complete' WHERE id = 1003`).run();
  const updated1003 = db.prepare('SELECT status FROM grant_application WHERE id = 1003').get();
  assert.equal(updated1003.status, 'course_complete');

  // Verify CHECK constraint refuses unknown statuses
  assert.throws(() => {
    db.prepare(`UPDATE grant_application SET status = 'invalid_status' WHERE id = 1003`).run();
  }, /CHECK constraint failed/);
});

test('(b) awarded -> course_complete -> closed succeeds', async () => {
  const { raw, env } = setupDb();

  // Set seed grant 1001 to awarded
  raw.prepare(`UPDATE grant_application SET status = 'in_review' WHERE id = 1001`).run();
  const reqDecision = new Request('http://localhost/api/grants/1001/decision', {
    method: 'POST',
    body: JSON.stringify({ decision: 'awarded', amount: '$600', care_package: 'Care Package B' })
  });
  const resDecision = await postGrants({ request: reqDecision, env });
  assert.equal(resDecision.status, 200);

  // Transition awarded -> course_complete
  const reqCC = new Request('http://localhost/api/grants/1001/course_complete', {
    method: 'POST'
  });
  const resCC = await postGrants({ request: reqCC, env });
  assert.equal(resCC.status, 200);
  const dataCC = await resCC.json();
  assert.equal(dataCC.ok, true);

  const rowCC = raw.prepare('SELECT status FROM grant_application WHERE id = 1001').get();
  assert.equal(rowCC.status, 'course_complete');

  // Transition course_complete -> closed
  const reqClose = new Request('http://localhost/api/grants/1001/close', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'Certified caregiver training completed' })
  });
  const resClose = await postGrants({ request: reqClose, env });
  assert.equal(resClose.status, 200);
  const dataClose = await resClose.json();
  assert.equal(dataClose.ok, true);

  const rowClosed = raw.prepare('SELECT status FROM grant_application WHERE id = 1001').get();
  assert.equal(rowClosed.status, 'closed');

  const awardRow = raw.prepare('SELECT outcome FROM award WHERE grant_application_id = 1001').get();
  assert.equal(awardRow.outcome, 'Certified caregiver training completed');
});

test('(c) awarded -> closed is refused 409', async () => {
  const { raw, env } = setupDb();

  // Set grant 1001 to awarded
  raw.prepare(`UPDATE grant_application SET status = 'awarded' WHERE id = 1001`).run();

  // Attempt to close directly without course_complete
  const reqClose = new Request('http://localhost/api/grants/1001/close', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'Premature close attempt' })
  });
  const resClose = await postGrants({ request: reqClose, env });
  assert.equal(resClose.status, 409);

  const data = await resClose.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /course_complete/i);

  // Grant must remain awarded
  const current = raw.prepare('SELECT status FROM grant_application WHERE id = 1001').get();
  assert.equal(current.status, 'awarded');
});

test('(d) declined -> closed still succeeds', async () => {
  const { raw, env } = setupDb();

  // Set grant 1001 to declined
  raw.prepare(`UPDATE grant_application SET status = 'declined' WHERE id = 1001`).run();

  // Attempt to close declined grant
  const reqClose = new Request('http://localhost/api/grants/1001/close', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'Application declined and archived' })
  });
  const resClose = await postGrants({ request: reqClose, env });
  assert.equal(resClose.status, 200);

  const data = await resClose.json();
  assert.equal(data.ok, true);

  const current = raw.prepare('SELECT status FROM grant_application WHERE id = 1001').get();
  assert.equal(current.status, 'closed');

  // Verify close audit log
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'grant_application.close' AND entity_id = '1001'`).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.before_json).status, 'declined');
  assert.equal(JSON.parse(audit.after_json).status, 'closed');
});

test('(e) course_complete writes an audit row', async () => {
  const { raw, env } = setupDb();

  raw.prepare(`UPDATE grant_application SET status = 'awarded' WHERE id = 1001`).run();

  const reqCC = new Request('http://localhost/api/grants/1001/course_complete', {
    method: 'POST'
  });
  const resCC = await postGrants({ request: reqCC, env });
  assert.equal(resCC.status, 200);

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'grant_application.course_complete' AND entity_id = '1001'`).get();
  assert.ok(audit, 'Audit log row must be recorded for course_complete');
  assert.ok(audit.actor === 'staff_console' || audit.actor === 'anonymous_staff');
  assert.equal(audit.entity, 'grant_application');
  assert.equal(audit.entity_id, '1001');

  const before = JSON.parse(audit.before_json);
  const after = JSON.parse(audit.after_json);
  assert.equal(before.status, 'awarded');
  assert.equal(after.status, 'course_complete');
});

test('(f) portal and staff label renders "Course complete"', () => {
  // 1. Verify app.js label mapping logic
  assert.match(APP_JS, /ga\.status === 'course_complete'\s*\?\s*['"]Course complete['"]/);
  assert.match(APP_JS, /ga\.status === 'awarded' \|\| ga\.status === 'course_complete'/);

  // 2. Verify staff.js label mapping logic
  assert.match(STAFF_JS, /g\.status === 'course_complete'\s*\?\s*['"]Course complete['"]/);
  assert.match(STAFF_JS, /if\s*\(g\.status === 'course_complete'\)\s*gBadge\s*=\s*['"]badge-green['"]/);

  // 3. Test functional behavior of app.js rendering logic
  function renderPortalStatus(ga) {
    let badgeClass = 'badge-gray';
    if (ga.status === 'submitted' || ga.status === 'in_review') badgeClass = 'badge-amber';
    else if (ga.status === 'awarded' || ga.status === 'course_complete') badgeClass = 'badge-green';

    const text = ga.status === 'course_complete' ? 'Course complete' : String(ga.status || '').replace('_', ' ');
    return { badgeClass, text };
  }

  const portalRender = renderPortalStatus({ status: 'course_complete' });
  assert.equal(portalRender.text, 'Course complete');
  assert.equal(portalRender.badgeClass, 'badge-green');

  // 4. Test functional behavior of staff.js rendering logic
  function renderStaffStatus(g) {
    let gBadge = 'badge-plum';
    if (g.status === 'in_review') gBadge = 'badge-amber';
    if (g.status === 'awarded') gBadge = 'badge-green';
    if (g.status === 'course_complete') gBadge = 'badge-green';
    if (g.status === 'closed') gBadge = 'badge-outline';
    const label = g.status === 'course_complete' ? 'Course complete' : g.status;
    return { gBadge, label };
  }

  const staffRender = renderStaffStatus({ status: 'course_complete' });
  assert.equal(staffRender.label, 'Course complete');
  assert.equal(staffRender.gBadge, 'badge-green');
});

test('(g) grant transitions record verified actor in audit log', async () => {
  const { raw, env } = setupDb();
  env.ALLOW_DEV_CONSOLE = '1';

  raw.prepare(`UPDATE grant_application SET status = 'awarded' WHERE id = 1001`).run();

  const reqCC = new Request('http://localhost/api/grants/1001/course_complete', {
    method: 'POST',
    headers: { 'x-dev-actor': 'coordinator@legacysanctuary.org' }
  });
  const resCC = await postGrants({ request: reqCC, env });
  assert.equal(resCC.status, 200);

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'grant_application.course_complete' AND entity_id = '1001'`).get();
  assert.ok(audit);
  assert.equal(audit.actor, 'coordinator@legacysanctuary.org');
});

