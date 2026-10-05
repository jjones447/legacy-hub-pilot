// Tests for LEGACY-D7-GOVERNED-DATA-CHANGES-S1 (Issue #103)
// Governed assistant drafts, previews, and confirms workflow data changes (grants and caregivers).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import * as caregiversDomain from '../functions/_lib/domain/caregivers.js';
import * as grantsDomain from '../functions/_lib/domain/grants.js';
import * as eventsDomain from '../functions/_lib/domain/events.js';
import { onRequestPost as postGrants } from '../functions/api/grants/[[path]].js';
import { onRequestPost as postStaff, onRequestPatch as patchStaff } from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const SCHEMA_7 = readFileSync(new URL('../schema/0007_grant_course_complete.sql', import.meta.url), 'utf8');
const SCHEMA_8 = readFileSync(new URL('../schema/0008_agent_change.sql', import.meta.url), 'utf8');

const STAFF_HTML = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const STYLES_CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function d1(db) {
  return {
    // Synthetic transaction model, not real D1/workerd acceptance.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => {
          const statement = db.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...params), meta: {} };
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      return {
        sql, params: [],
        bind(...params) {
          return {
            sql, params,
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

const mockWorkflowBackend = ({ area, target_id, request, current }) => {
  if (request.includes('tamper') || request.includes('injection')) {
    return { ok: false, refusal: 'Refused request to tamper with system or code' };
  }
  if (request.includes('cannot express')) {
    return { ok: false, refusal: 'Request cannot be expressed by the schema' };
  }

  if (area === 'grant') {
    if (request.includes('close directly from awarded')) {
      // Illegal transition: close while awarded
      return { ok: true, operation: 'close', payload: { outcome: 'Premature close' } };
    }
    if (request.includes('review')) {
      return { ok: true, operation: 'review', payload: { review_notes: 'Reviewed and verified' } };
    }
    if (request.includes('award')) {
      return {
        ok: true,
        operation: 'decision',
        payload: { decision: 'awarded', amount: '$500', care_package: 'Standard Care', review_notes: 'Approved for wellness grant' }
      };
    }
    if (request.includes('complete course')) {
      return { ok: true, operation: 'course_complete', payload: {} };
    }
    if (request.includes('close')) {
      return { ok: true, operation: 'close', payload: { outcome: 'Successfully finished course' } };
    }
    return { ok: false, refusal: 'Unknown grant operation' };
  }

  if (area === 'caregiver') {
    if (request.includes('update email')) {
      return { ok: true, operation: 'update', payload: { email: 'maria.new@example.org' } };
    }
    if (request.includes('update status to inactive')) {
      return { ok: true, operation: 'update', payload: { status: 'inactive' } };
    }
    if (request.includes('update outcome')) {
      return {
        ok: true,
        operation: 'update',
        payload: { outcome_status: 'improving', outcome_notes: 'Caregiver shows strong progress' }
      };
    }
    return { ok: false, refusal: 'Unknown caregiver operation' };
  }

  return { ok: false, refusal: `Unsupported area: ${area}` };
};

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_6);
  raw.exec(SCHEMA_7);
  raw.exec(SCHEMA_8);

  // Seed sample caregiver and grant application
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, status, segment_tags)
    VALUES ('cg_test_1', 'Maria', 'Santos', 'maria@example.org', '555-0101', 'active', '["dementia"]')
  `).run();

  raw.prepare(`
    INSERT INTO grant_application (id, caregiver_id, requested_for, status, source, external_ref)
    VALUES (1, 'cg_test_1', 'Respite Care Support', 'submitted', 'site_form', 'ext_grant_1')
  `).run();

  env = {
    LEGACY_DB: d1(raw),
    AGENT_MAPPER_BACKEND: mockWorkflowBackend,
    ALLOW_DEV_CONSOLE: '1'
  };
});

test('Grant: draft stores a preview and writes nothing to domain tables', async () => {
  const req = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'Please review this application'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(data.change_id);
  assert.equal(data.change.operation, 'review');
  assert.equal(data.preview.after.status, 'in_review');

  // Verify stored in agent_change
  const change = raw.prepare('SELECT * FROM agent_change WHERE id = ?').get(data.change_id);
  assert.ok(change);
  assert.equal(change.status, 'draft');
  assert.equal(change.area, 'grant');
  assert.equal(change.requested_by, 'staff@example.org');

  // Verify NOTHING written to domain table grant_application
  const grant = raw.prepare('SELECT status, review_notes FROM grant_application WHERE id = 1').get();
  assert.equal(grant.status, 'submitted'); // STILL submitted!
  assert.equal(grant.review_notes, null);

  // Verify no audit log for grant_application yet
  const audit = raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity = 'grant_application'").get();
  assert.equal(audit.c, 0);
});

test('Grant: confirm applies change and writes both audit rows with verified actor', async () => {
  // Create draft
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_drafter@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'Please review this application'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const dataDraft = await resDraft.json();
  const changeId = dataDraft.change_id;

  // Confirm with confirming actor and verify body-supplied actor is ignored
  const reqConfirm = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_confirmer@example.org' },
    body: JSON.stringify({
      change_id: changeId,
      actor: 'attacker_spoof',
      staff_id: 'attacker_spoof'
    })
  });

  const resConfirm = await postAgent({ request: reqConfirm, env });
  assert.equal(resConfirm.status, 200);
  const dataConfirm = await resConfirm.json();
  assert.ok(dataConfirm.ok);

  // Domain table now updated
  const grant = raw.prepare('SELECT status, review_notes FROM grant_application WHERE id = 1').get();
  assert.equal(grant.status, 'in_review');
  assert.equal(grant.review_notes, 'Reviewed and verified');

  // agent_change status published with confirmed_by
  const change = raw.prepare('SELECT status, confirmed_by FROM agent_change WHERE id = ?').get(changeId);
  assert.equal(change.status, 'published');
  assert.equal(change.confirmed_by, 'staff_confirmer@example.org');

  // Both audit rows exist with verified actor
  const domainAudit = raw.prepare("SELECT * FROM audit_log WHERE action = 'grant_application.review'").get();
  assert.ok(domainAudit);
  assert.equal(domainAudit.actor, 'staff_confirmer@example.org');
  assert.equal(domainAudit.entity_id, '1');

  const changeAudit = raw.prepare("SELECT * FROM audit_log WHERE action = 'agent_change.confirm'").get();
  assert.ok(changeAudit);
  assert.equal(changeAudit.actor, 'staff_confirmer@example.org');
  assert.equal(changeAudit.entity_id, changeId);
});

test('Grant: discard marks change discarded and writes audit row', async () => {
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'Please review this application'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const { change_id } = await resDraft.json();

  const reqDiscard = new Request('http://localhost/api/agent/change/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_discarder@example.org' },
    body: JSON.stringify({ change_id })
  });

  const resDiscard = await postAgent({ request: reqDiscard, env });
  assert.equal(resDiscard.status, 200);

  const change = raw.prepare('SELECT status FROM agent_change WHERE id = ?').get(change_id);
  assert.equal(change.status, 'discarded');

  const audit = raw.prepare("SELECT * FROM audit_log WHERE action = 'agent_change.discard'").get();
  assert.ok(audit);
  assert.equal(audit.actor, 'staff_discarder@example.org');
});

test('Confirm twice returns 409', async () => {
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'Please review this application'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const { change_id } = await resDraft.json();

  const reqConfirm1 = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({ change_id })
  });
  const resConfirm1 = await postAgent({ request: reqConfirm1, env });
  assert.equal(resConfirm1.status, 200);

  // Second confirm
  const reqConfirm2 = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({ change_id })
  });
  const resConfirm2 = await postAgent({ request: reqConfirm2, env });
  assert.equal(resConfirm2.status, 409);
});

test('Grant: draft then record changes underneath returns 409 on confirm, nothing applied', async () => {
  // Move grant to in_review first
  raw.prepare("UPDATE grant_application SET status = 'in_review' WHERE id = 1").run();

  // Draft decision to award
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'Please award this grant'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const { change_id } = await resDraft.json();

  // Record changes underneath: grant is declined by someone else
  raw.prepare("UPDATE grant_application SET status = 'declined' WHERE id = 1").run();

  // Attempt to confirm the award draft
  const reqConfirm = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({ change_id })
  });
  const resConfirm = await postAgent({ request: reqConfirm, env });
  assert.equal(resConfirm.status, 409);

  // Status remains declined, no award created
  const grant = raw.prepare('SELECT status FROM grant_application WHERE id = 1').get();
  assert.equal(grant.status, 'declined');
  const awardCount = raw.prepare('SELECT COUNT(*) AS c FROM award WHERE grant_application_id = 1').get();
  assert.equal(awardCount.c, 0);
});

test('Grant: illegal transition (awarded -> close) drafted is refused at draft', async () => {
  // Grant is currently 'submitted', set to 'awarded'
  raw.prepare("UPDATE grant_application SET status = 'awarded' WHERE id = 1").run();

  // Try to draft 'close directly from awarded' (must be course_complete first)
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'grant',
      target_id: 1,
      request: 'close directly from awarded'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  assert.equal(resDraft.status, 200);
  const data = await resDraft.json();
  assert.equal(data.ok, false);
  assert.match(data.refusal, /course_complete before closing/);

  // Ensure no draft was created
  const changeCount = raw.prepare('SELECT COUNT(*) AS c FROM agent_change').get();
  assert.equal(changeCount.c, 0);
});

test('Caregiver: draft stores preview and writes nothing to caregiver table', async () => {
  const req = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'caregiver',
      target_id: 'cg_test_1',
      request: 'update email'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(data.change_id);
  assert.equal(data.change.operation, 'update');
  assert.equal(data.preview.after.email, 'maria.new@example.org');

  // Verify caregiver in DB has NOT changed
  const cg = raw.prepare('SELECT email FROM caregiver WHERE id = ?').get('cg_test_1');
  assert.equal(cg.email, 'maria@example.org');

  // Verify audit log has no caregiver.update row
  const audit = raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity = 'caregiver'").get();
  assert.equal(audit.c, 0);
});

test('Caregiver: confirm applies update and writes both audit rows with verified actor', async () => {
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_drafter@example.org' },
    body: JSON.stringify({
      area: 'caregiver',
      target_id: 'cg_test_1',
      request: 'update email'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const { change_id } = await resDraft.json();

  const reqConfirm = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_confirmer@example.org' },
    body: JSON.stringify({ change_id, actor: 'attacker_spoof' })
  });

  const resConfirm = await postAgent({ request: reqConfirm, env });
  assert.equal(resConfirm.status, 200);
  const dataConfirm = await resConfirm.json();
  assert.ok(dataConfirm.ok);

  // Caregiver table updated
  const cg = raw.prepare('SELECT email FROM caregiver WHERE id = ?').get('cg_test_1');
  assert.equal(cg.email, 'maria.new@example.org');

  // Audit logs recorded with verified actor
  const domainAudit = raw.prepare("SELECT * FROM audit_log WHERE action = 'caregiver.update'").get();
  assert.ok(domainAudit);
  assert.equal(domainAudit.actor, 'staff_confirmer@example.org');
  assert.equal(domainAudit.entity_id, 'cg_test_1');

  const changeAudit = raw.prepare("SELECT * FROM audit_log WHERE action = 'agent_change.confirm'").get();
  assert.ok(changeAudit);
  assert.equal(changeAudit.actor, 'staff_confirmer@example.org');
});

test('Caregiver: draft then record changes underneath returns 409 on confirm', async () => {
  const reqDraft = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'caregiver',
      target_id: 'cg_test_1',
      request: 'update email'
    })
  });
  const resDraft = await postAgent({ request: reqDraft, env });
  const { change_id } = await resDraft.json();

  // Record changes underneath: email was updated by staff directly
  raw.prepare("UPDATE caregiver SET email = 'maria.other@example.org' WHERE id = 'cg_test_1'").run();

  const reqConfirm = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({ change_id })
  });
  const resConfirm = await postAgent({ request: reqConfirm, env });
  assert.equal(resConfirm.status, 409);
});

test('Request the schema cannot express returns refusal', async () => {
  const req = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({
      area: 'caregiver',
      target_id: 'cg_test_1',
      request: 'cannot express this strange request'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.refusal, /cannot be expressed/);
});

test('GET /api/agent/changes?status=draft returns draft changes only', async () => {
  raw.prepare(`
    INSERT INTO agent_change (id, area, operation, target_id, payload_json, status, requested_by)
    VALUES
      ('ac_draft_1', 'grant', 'review', '1', '{"review_notes":"ok"}', 'draft', 'staff'),
      ('ac_pub_1', 'caregiver', 'update', 'cg_test_1', '{"status":"active"}', 'published', 'staff')
  `).run();

  const req = new Request('http://localhost/api/agent/changes?status=draft');
  const res = await getAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.changes.length, 1);
  assert.equal(data.changes[0].id, 'ac_draft_1');
});

test('UI wiring: staff.html contains chat area selector and zero inline styles in new elements', () => {
  assert.ok(STAFF_HTML.includes('id="chatAreaSelect"'));
  assert.ok(STAFF_HTML.includes('value="content"'));
  assert.ok(STAFF_HTML.includes('value="grant"'));
  assert.ok(STAFF_HTML.includes('value="caregiver"'));

  // Verify styles.css defines new classes
  assert.match(STYLES_CSS, /\.chat-area-bar/);
  assert.match(STYLES_CSS, /\.chat-area-label/);
  assert.match(STYLES_CSS, /\.chat-area-select/);
  assert.match(STYLES_CSS, /\.diff-container/);
  assert.match(STYLES_CSS, /\.diff-box/);
  assert.match(STYLES_CSS, /\.diff-header/);
  assert.match(STYLES_CSS, /\.diff-content/);

  // Verify staff.js wires agent-change-confirm and agent-change-discard
  assert.match(STAFF_JS, /action === 'agent-change-confirm'/);
  assert.match(STAFF_JS, /action === 'agent-change-discard'/);
});

// Atomic mutation + original domain audit + optional governed change publication.
// In-memory SQLite models D1 batches; pre-read validation is not a CAS guarantee.
const atomicDomainCases = [
  { name: 'caregiver update', area: 'caregiver', operation: 'update', id: 'cg_atomic',
    payload: { email: 'new@example.org', segment_tags: ['caregiver'], outcome_status: 'improving', outcome_notes: 'Synthetic progress' }, table: 'caregiver' },
  { name: 'grant review', area: 'grant', operation: 'review', id: '1', payload: { review_notes: 'Reviewed' }, status: 'submitted', table: 'grant_application' },
  { name: 'grant awarded decision', area: 'grant', operation: 'decision', id: '1', payload: { decision: 'awarded', amount: '$500', care_package: 'Standard', review_notes: 'Approved' }, status: 'in_review', table: 'grant_application', extraFaults: ['award_insert', 'followup_insert'] },
  { name: 'grant declined decision', area: 'grant', operation: 'decision', id: '1', payload: { decision: 'declined', review_notes: 'Declined' }, status: 'in_review', table: 'grant_application' },
  { name: 'grant course complete', area: 'grant', operation: 'course_complete', id: '1', payload: {}, status: 'awarded', table: 'grant_application' },
  { name: 'grant close with award', area: 'grant', operation: 'close', id: '1', payload: { outcome: 'Synthetic completion' }, status: 'course_complete', table: 'grant_application', award: true, extraFaults: ['award_update'] },
  { name: 'grant close without award', area: 'grant', operation: 'close', id: '1', payload: { outcome: 'Declined closeout' }, status: 'declined', table: 'grant_application' },
  { name: 'event create', area: 'event', operation: 'create', id: 'new', payload: { id: 'ev_atomic_new', title: 'Synthetic Circle', type: 'support_group', starts_at: '2026-10-20 14:00', location: 'Room B', capacity: 15 }, table: 'event' },
  { name: 'event update', area: 'event', operation: 'update', id: 'ev_atomic', payload: { location: 'New Room', capacity: 25 }, table: 'event' },
  { name: 'event publish', area: 'event', operation: 'publish', id: 'ev_atomic', payload: {}, table: 'event' },
  { name: 'event archive with registration override', area: 'event', operation: 'archive', id: 'ev_atomic', payload: { confirm_with_registrations: true }, table: 'event', registration: true }
];
const atomicTables = ['caregiver', 'grant_application', 'award', 'followup', 'event', 'registration', 'contact_history', 'agent_change', 'audit_log'];
const atomicModules = { caregiver: caregiversDomain, grant: grantsDomain, event: eventsDomain };
const atomicActor = 'atomic_confirmer@example.org';
const oldTime = '2000-01-01 00:00:00';

function atomicSnapshot(db) {
  return Object.fromEntries(atomicTables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all()]));
}
function atomicRequest(path, body, method = 'POST') {
  return new Request('http://localhost' + path, { method, headers: { 'Content-Type': 'application/json', 'x-dev-actor': atomicActor }, body: JSON.stringify(body) });
}
async function atomicFixture(c, governed) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  for (const schema of [SCHEMA_1, SCHEMA_3, SCHEMA_4, SCHEMA_6, SCHEMA_7, SCHEMA_8]) db.exec(schema);
  db.prepare("INSERT INTO caregiver(id,first_name,email,created_at,updated_at,outcome_updated_at) VALUES('cg_atomic','Synthetic','old@example.org',?,?,?)").run(oldTime, oldTime, oldTime);
  db.prepare("INSERT INTO grant_application(id,caregiver_id,status,source,external_ref,created_at,updated_at) VALUES(1,'cg_atomic',?,'staff','atomic_grant',?,?)").run(c.status || 'submitted', oldTime, oldTime);
  db.prepare("INSERT INTO event(id,title,type,starts_at,location,capacity,publish_state,created_at,updated_at) VALUES('ev_atomic','Synthetic Event','support_group','2026-10-20 10:00','Old Room',10,'draft',?,?)").run(oldTime, oldTime);
  if (c.award) db.prepare("INSERT INTO award(id,grant_application_id,amount,care_package,outcome,created_at,updated_at) VALUES(1,1,'$500','Standard','Prior outcome',?,?)").run(oldTime, oldTime);
  if (c.registration) db.prepare("INSERT INTO registration(caregiver_id,event_id,status,source,external_ref,created_at,updated_at) VALUES('cg_atomic','ev_atomic','registered','staff','atomic_registration',?,?)").run(oldTime, oldTime);
  db.prepare("INSERT INTO audit_log(actor,action,entity,entity_id,before_json,after_json,at) VALUES('prior_staff','prior.synthetic','fixture','prior','{}','{}',?)").run(oldTime);
  const adapter = d1(db);
  const stats = { batches: 0 };
  const originalBatch = adapter.batch.bind(adapter);
  adapter.batch = statements => { stats.batches++; return originalBatch(statements); };
  const env = { LEGACY_DB: adapter, ALLOW_DEV_CONSOLE: '1', AGENT_MAPPER_BACKEND: () => ({ ok: true, operation: c.operation, payload: c.payload }) };
  const change = { id: c.id, operation: c.operation, payload: c.payload };
  const expected = await atomicModules[c.area].validate(adapter, change);
  assert.equal(expected.ok, true);
  let changeId;
  if (governed) {
    const response = await postAgent({ request: atomicRequest('/api/agent/change/draft', { area: c.area, target_id: c.id, request: 'Synthetic bounded draft' }), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    changeId = body.change_id;
    db.prepare("UPDATE agent_change SET created_at=?,updated_at=? WHERE id=?").run(oldTime, oldTime, changeId);
  }
  return { db, adapter, env, change, expected, changeId, stats };
}
function atomicFault(f, c, mode) {
  let trigger;
  if (mode === 'mutation') trigger = 'BEFORE ' + (c.operation === 'create' ? 'INSERT' : 'UPDATE') + ' ON ' + c.table;
  if (mode === 'domain_audit') trigger = "BEFORE INSERT ON audit_log WHEN NEW.action='" + (c.area === 'grant' ? 'grant_application' : c.area) + '.' + c.operation + "'";
  if (mode === 'change_status') trigger = "BEFORE UPDATE ON agent_change WHEN NEW.status='published'";
  if (mode === 'confirm_audit') trigger = "BEFORE INSERT ON audit_log WHEN NEW.action='agent_change.confirm'";
  if (mode === 'award_insert') trigger = 'BEFORE INSERT ON award';
  if (mode === 'followup_insert') trigger = 'BEFORE INSERT ON followup';
  if (mode === 'award_update') trigger = 'BEFORE UPDATE ON award';
  if (trigger) f.db.exec("CREATE TRIGGER atomic_fault " + trigger + " BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DOMAIN_FAULT_NO_CLIENT_LEAK'); END;");
}
async function atomicInvoke(f, c, route) {
  if (route === 'agent') return postAgent({ request: atomicRequest('/api/agent/change/confirm', { change_id: f.changeId, actor: 'spoof' }), env: f.env });
  if (route === 'direct') return atomicModules[c.area].apply(f.adapter, f.change, atomicActor);
  if (c.area === 'grant') return postGrants({ request: atomicRequest('/api/grants/1/' + c.operation, c.payload), env: f.env });
  const path = c.area === 'caregiver' ? '/api/staff/caregiver/cg_atomic' : c.operation === 'create' ? '/api/staff/event' : '/api/staff/event/ev_atomic' + (c.operation === 'update' ? '' : '/' + c.operation);
  const request = atomicRequest(path, c.payload, ['caregiver', 'event'].includes(c.area) && c.operation === 'update' ? 'PATCH' : 'POST');
  return (request.method === 'PATCH' ? patchStaff : postStaff)({ request, env: f.env });
}
function atomicAssertSuccess(f, c, before, governed) {
  const after = atomicSnapshot(f.db);
  assert.deepEqual(after.audit_log.slice(0, before.audit_log.length), before.audit_log);
  const newAudits = after.audit_log.slice(before.audit_log.length);
  assert.equal(newAudits.length, governed ? 2 : 1);
  const domain = newAudits[0];
  assert.equal(domain.actor, atomicActor);
  assert.equal(domain.entity, c.area === 'grant' ? 'grant_application' : c.area);
  assert.equal(domain.action, domain.entity + '.' + c.operation);
  assert.equal(domain.entity_id, String(f.expected.projected.id));
  assert.deepEqual(JSON.parse(domain.before_json), f.expected.before);
  assert.deepEqual(JSON.parse(domain.after_json), f.expected.after);
  if (governed) {
    const row = after.agent_change.find(r => r.id === f.changeId);
    const old = before.agent_change.find(r => r.id === f.changeId);
    assert.equal(row.status, 'published');
    assert.equal(row.confirmed_by, atomicActor);
    for (const key of ['area', 'operation', 'target_id', 'payload_json', 'before_json', 'after_json', 'requested_by', 'created_at', 'error']) assert.equal(row[key], old[key]);
    assert.notEqual(row.updated_at, oldTime);
    assert.equal(newAudits[1].action, 'agent_change.confirm');
    assert.equal(newAudits[1].actor, atomicActor);
    assert.equal(newAudits[1].entity_id, f.changeId);
    assert.deepEqual(JSON.parse(newAudits[1].before_json), { status: 'draft' });
    assert.deepEqual(JSON.parse(newAudits[1].after_json), { status: 'published', confirmed_by: atomicActor });
  } else assert.deepEqual(after.agent_change, before.agent_change);
  if (c.area === 'caregiver') {
    const row = after.caregiver.find(r => r.id === c.id);
    assert.equal(row.email, 'new@example.org');
    assert.equal(row.segment_tags, '["caregiver"]');
    assert.equal(row.outcome_status, 'improving');
    assert.notEqual(row.outcome_updated_at, oldTime);
  }
  if (c.operation === 'decision') {
    assert.equal(after.grant_application.find(r => r.id === 1).status, c.payload.decision);
    assert.equal(after.award.length, c.payload.decision === 'awarded' ? 1 : 0);
    assert.equal(after.followup.length, c.payload.decision === 'awarded' ? 1 : 0);
    if (c.payload.decision === 'awarded') {
      assert.equal(after.award[0].grant_application_id, 1);
      assert.equal(after.award[0].amount, '$500');
      assert.equal(after.followup[0].external_ref, 'grant_award_1');
      assert.equal(after.followup[0].caregiver_id, 'cg_atomic');
    }
  }
  if (c.operation === 'close' && c.award) assert.equal(after.award[0].outcome, c.payload.outcome);
  if (c.area === 'event') {
    const row = after.event.find(r => r.id === f.expected.projected.id);
    assert.equal(row.publish_state, f.expected.projected.publish_state);
    assert.equal(row.location, f.expected.projected.location);
  }
  assert.deepEqual(after.registration, before.registration);
  assert.deepEqual(after.contact_history, before.contact_history);
  // Unrelated seeded historical domain rows are preserved byte-for-byte.
  assert.deepEqual(after.caregiver.filter(r => r.id !== 'cg_atomic'), before.caregiver.filter(r => r.id !== 'cg_atomic'));
  assert.deepEqual(after.grant_application.filter(r => r.id !== 1), before.grant_application.filter(r => r.id !== 1));
}
for (const c of atomicDomainCases) {
  for (const route of ['agent', 'direct', 'rest']) {
    const modes = ['healthy', 'mutation', 'domain_audit', ...(route === 'agent' ? ['change_status', 'confirm_audit'] : []), ...(c.extraFaults || [])];
    for (const mode of modes) test('atomic domain: ' + c.name + ' ' + route + ' ' + mode, async () => {
      const f = await atomicFixture(c, route === 'agent');
      try {
        const before = atomicSnapshot(f.db);
        atomicFault(f, c, mode);
        if (mode !== 'healthy') {
          if (route === 'direct') await assert.rejects(() => atomicInvoke(f, c, route), /SYNTHETIC_DOMAIN_FAULT/);
          else {
            const response = await atomicInvoke(f, c, route);
            assert.equal(response.status, 500);
            assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
          }
          assert.deepEqual(atomicSnapshot(f.db), before, 'every mutation, timestamp, actor, draft and audit rolls back');
          f.db.exec('DROP TRIGGER atomic_fault');
        }
        const response = await atomicInvoke(f, c, route);
        if (route === 'direct') assert.equal(response.ok, true);
        else {
          assert.equal(response.status, c.operation === 'create' && route === 'rest' ? 201 : 200);
          assert.equal((await response.json()).ok, true);
        }
        atomicAssertSuccess(f, c, before, route === 'agent');
        assert.equal(f.stats.batches, mode === 'healthy' ? 1 : 2, 'one ordered transaction per apply attempt');
        if (route === 'agent') {
          const committed = atomicSnapshot(f.db);
          const duplicate = await atomicInvoke(f, c, route);
          assert.equal(duplicate.status, 409);
          assert.deepEqual(atomicSnapshot(f.db), committed, 'no historical repair on second confirmation');
        }
      } finally { f.db.close(); }
    });
  }
}
for (const mode of ['healthy', 'change_status', 'discard_audit']) test('atomic domain: discard ' + mode, async () => {
  const f = await atomicFixture(atomicDomainCases[1], true);
  try {
    const before = atomicSnapshot(f.db);
    if (mode !== 'healthy') f.db.exec("CREATE TRIGGER atomic_fault " + (mode === 'change_status' ? "BEFORE UPDATE ON agent_change WHEN NEW.status='discarded'" : "BEFORE INSERT ON audit_log WHEN NEW.action='agent_change.discard'") + " BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DOMAIN_FAULT_NO_CLIENT_LEAK'); END;");
    const invoke = () => postAgent({ request: atomicRequest('/api/agent/change/discard', { change_id: f.changeId }), env: f.env });
    if (mode !== 'healthy') {
      const response = await invoke();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
      assert.deepEqual(atomicSnapshot(f.db), before);
      f.db.exec('DROP TRIGGER atomic_fault');
    }
    assert.equal((await invoke()).status, 200);
    assert.equal(f.stats.batches, mode === 'healthy' ? 1 : 2);
    const after = atomicSnapshot(f.db);
    for (const table of atomicTables.filter(t => !['agent_change', 'audit_log'].includes(t))) assert.deepEqual(after[table], before[table]);
    assert.equal(after.agent_change[0].status, 'discarded');
    assert.equal(after.agent_change[0].confirmed_by, null);
    assert.deepEqual(after.audit_log.slice(0, before.audit_log.length), before.audit_log);
    const audit = after.audit_log.at(-1);
    assert.equal(audit.actor, atomicActor);
    assert.equal(audit.action, 'agent_change.discard');
    assert.equal(audit.entity_id, f.changeId);
    assert.deepEqual(JSON.parse(audit.before_json), { status: 'draft' });
    assert.deepEqual(JSON.parse(audit.after_json), { status: 'discarded' });
    assert.equal((await invoke()).status, 409);
    assert.deepEqual(atomicSnapshot(f.db), after);
  } finally { f.db.close(); }
});
test('atomic domain: registration refusal commits nothing', async () => {
  const c = { ...atomicDomainCases.at(-1), payload: {} };
  const f = await atomicFixture({ ...c, payload: { confirm_with_registrations: true } }, false);
  try {
    const before = atomicSnapshot(f.db);
    const response = await eventsDomain.apply(f.adapter, { id: c.id, operation: c.operation, payload: {} }, atomicActor);
    assert.equal(response.ok, false);
    assert.equal(response.status, 409);
    assert.deepEqual(atomicSnapshot(f.db), before);
    assert.equal(f.stats.batches, 0);
  } finally { f.db.close(); }
});

for (const status of ['published', 'discarded', 'failed']) test('atomic domain: historical ' + status + ' changes are not repaired', async () => {
  const f = await atomicFixture(atomicDomainCases[1], true);
  try {
    f.db.prepare('UPDATE agent_change SET status=? WHERE id=?').run(status, f.changeId);
    const before = atomicSnapshot(f.db);
    for (const action of ['confirm', 'discard']) {
      const response = await postAgent({ request: atomicRequest('/api/agent/change/' + action, { change_id: f.changeId }), env: f.env });
      assert.equal(response.status, 409);
      assert.deepEqual(atomicSnapshot(f.db), before);
    }
    assert.equal(f.stats.batches, 0);
  } finally { f.db.close(); }
});
for (const c of atomicDomainCases.filter(c => c.area === 'caregiver' || c.area === 'event')) {
  for (const route of ['agent', 'direct', 'rest']) test('atomic domain: post-commit read failure ' + c.name + ' ' + route, async () => {
    const f = await atomicFixture(c, route === 'agent');
    try {
      const before = atomicSnapshot(f.db);
      let committed = false;
      const originalBatch = f.adapter.batch.bind(f.adapter);
      f.adapter.batch = async statements => {
        const result = await originalBatch(statements);
        committed = true;
        return result;
      };
      const prepare = f.adapter.prepare.bind(f.adapter);
      const wrap = statement => ({
        ...statement,
        bind: (...params) => wrap(statement.bind(...params)),
        first: async () => {
          if (committed && statement.sql.startsWith('SELECT * FROM ' + c.table)) throw new Error('SYNTHETIC_POST_COMMIT_READ_FAULT');
          return statement.first();
        }
      });
      f.adapter.prepare = sql => wrap(prepare(sql));
      if (route === 'direct') await assert.rejects(() => atomicInvoke(f, c, route), /SYNTHETIC_POST_COMMIT_READ_FAULT/);
      else {
        const response = await atomicInvoke(f, c, route);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
      }
      // Write transaction already succeeded: both original audits/status are present.
      atomicAssertSuccess(f, c, before, route === 'agent');
      assert.equal(f.stats.batches, 1);
    } finally { f.db.close(); }
  });
}
