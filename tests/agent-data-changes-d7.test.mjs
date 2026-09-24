// Tests for LEGACY-D7-GOVERNED-DATA-CHANGES-S1 (Issue #103)
// Governed assistant drafts, previews, and confirms workflow data changes (grants and caregivers).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';

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
