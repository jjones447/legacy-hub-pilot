// Tests for LEGACY-D2-CAREGIVER-RECORD-R1 (Issue #96)
// Covers deliverables (a) through (h) explicitly:
// (a) Migration 0006 applies cleanly, preserves all existing tables and data, adds columns.
// (b) Search by name, email, phone, and paging bounds (limit, offset, max 100).
// (c) Segment filter matches exact token inside segment_tags JSON array (e.g. "carer" != "former_carer").
// (d) PATCH allow-list rejects unknown fields, id, created_at, updated_at, actor, recorded_by with 400.
// (e) PATCH valid update returns 200, updates DB, records audit log caregiver.update.
// (f) PATCH outcome field change stamps outcome_updated_at.
// (g) POST /api/staff/caregiver/:id/contact appends contact entry with recorded_by from getActor, writes audit log, rejects body-supplied recorded_by/actor with 400.
// (h) GET /api/staff/caregiver/:id returns all existing keys plus contact_history (newest first) and outcome columns in profile.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  onRequestGet as getStaff,
  onRequestPost as postStaff,
  onRequestPatch as patchStaff
} from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');

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
              const res = db.prepare(sql).run(...params);
              return { meta: { last_row_id: Number(res.lastInsertRowid) }, lastRowId: Number(res.lastInsertRowid) };
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
          const res = db.prepare(sql).run();
          return { meta: { last_row_id: Number(res.lastInsertRowid) }, lastRowId: Number(res.lastInsertRowid) };
        },
        async all() {
          return { results: db.prepare(sql).all() };
        }
      };
    }
  };
}

function mockRequest(urlStr, method = 'GET', body = null, headersObj = {}) {
  const normHeaders = {};
  for (const [k, v] of Object.entries(headersObj)) {
    normHeaders[k.toLowerCase()] = v;
  }
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      if (body === null || body === undefined) throw new Error('no body');
      return body;
    },
    async text() {
      if (typeof body === 'string') return body;
      return JSON.stringify(body ?? {});
    }
  };
}

let raw;
let env;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_6);
  env = {
    LEGACY_DB: d1(raw),
    ALLOW_DEV_CONSOLE: '1'
  };
});

test('(a) migration 0006 applies cleanly, preserves existing caregiver data, and adds columns', async () => {
  // Check tables exist
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('contact_history'), 'contact_history table should exist');
  assert.ok(tables.includes('caregiver'), 'caregiver table should exist');

  // Verify columns on caregiver
  const cols = raw.prepare("PRAGMA table_info(caregiver)").all().map(r => r.name);
  assert.ok(cols.includes('outcome_status'), 'outcome_status column should exist');
  assert.ok(cols.includes('outcome_notes'), 'outcome_notes column should exist');
  assert.ok(cols.includes('outcome_updated_at'), 'outcome_updated_at column should exist');

  // Verify existing seeded data intact
  const seeded = raw.prepare("SELECT * FROM caregiver WHERE id = 'cg_seed_fictional'").get();
  assert.ok(seeded, 'seeded caregiver exists');
  assert.equal(seeded.first_name, 'Jane');
  assert.equal(seeded.outcome_status, null);
  assert.equal(seeded.outcome_notes, null);
  assert.equal(seeded.outcome_updated_at, null);
});

test('(b) search by name, email, phone, and paging bounds', async () => {
  // Insert test caregivers
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, status, segment_tags, updated_at)
    VALUES
      ('cg_alice', 'Alice', 'Smith', 'alice@example.com', '555-0101', 'active', '["carer"]', '2026-09-01 10:00:00'),
      ('cg_bob', 'Bob', 'Jones', 'bob@example.com', '555-0102', 'active', '["former_carer"]', '2026-09-02 10:00:00'),
      ('cg_carol', 'Carol', 'Smith', 'carol@domain.org', '555-9999', 'inactive', '["carer", "respite"]', '2026-09-03 10:00:00')
  `).run();

  // Search by first name
  let req = mockRequest('http://localhost/api/staff/caregivers?q=Alice');
  let res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.caregivers[0].id, 'cg_alice');

  // Search by last name
  req = mockRequest('http://localhost/api/staff/caregivers?q=Smith');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.total, 2);

  // Search by combined full name
  req = mockRequest('http://localhost/api/staff/caregivers?q=Bob+Jones');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.caregivers[0].id, 'cg_bob');

  // Search by email
  req = mockRequest('http://localhost/api/staff/caregivers?q=domain.org');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.caregivers[0].id, 'cg_carol');

  // Search by phone
  req = mockRequest('http://localhost/api/staff/caregivers?q=555-0102');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.caregivers[0].id, 'cg_bob');

  // Filter by status
  req = mockRequest('http://localhost/api/staff/caregivers?status=inactive');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.caregivers[0].id, 'cg_carol');

  // Paging bounds: limit and offset
  req = mockRequest('http://localhost/api/staff/caregivers?limit=1&offset=0');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.limit, 1);
  assert.equal(data.offset, 0);
  assert.equal(data.caregivers.length, 1);

  // Max limit clamped to 100
  req = mockRequest('http://localhost/api/staff/caregivers?limit=500');
  res = await getStaff({ request: req, env });
  data = await res.json();
  assert.equal(data.limit, 100);
});

test('(c) segment filter matches exact token inside segment_tags JSON array (carer != former_carer)', async () => {
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, status, segment_tags, updated_at)
    VALUES
      ('cg_carer_only', 'One', 'User', 'u1@example.com', '555-1', 'active', '["carer"]', '2026-09-01 10:00:00'),
      ('cg_former_only', 'Two', 'User', 'u2@example.com', '555-2', 'active', '["former_carer"]', '2026-09-02 10:00:00'),
      ('cg_both', 'Three', 'User', 'u3@example.com', '555-3', 'active', '["respite", "carer", "donor"]', '2026-09-03 10:00:00')
  `).run();

  // Filter for 'carer' -> MUST match cg_carer_only and cg_both, MUST NOT match cg_former_only
  let req = mockRequest('http://localhost/api/staff/caregivers?segment=carer');
  let res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);
  let data = await res.json();
  const ids = data.caregivers.map(c => c.id);
  assert.ok(ids.includes('cg_carer_only'), 'carer should match cg_carer_only');
  assert.ok(ids.includes('cg_both'), 'carer should match cg_both');
  assert.ok(!ids.includes('cg_former_only'), 'carer MUST NOT match cg_former_only');

  // Filter for 'former_carer' -> MUST match cg_former_only, MUST NOT match cg_carer_only or cg_both
  req = mockRequest('http://localhost/api/staff/caregivers?segment=former_carer');
  res = await getStaff({ request: req, env });
  data = await res.json();
  const formerIds = data.caregivers.map(c => c.id);
  assert.deepEqual(formerIds, ['cg_former_only']);
});

test('(d) PATCH allow-list rejects unknown fields, id, created_at, updated_at, actor, recorded_by with 400', async () => {
  const caregiverId = 'cg_seed_fictional';

  // Unknown field
  let req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { foo: 'bar' });
  let res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // id
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { id: 'new_id' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // created_at
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { created_at: '2020-01-01' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // updated_at
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { updated_at: '2020-01-01' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // actor
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { actor: 'spoofed_actor' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // recorded_by
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { recorded_by: 'spoofed_recorder' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // outcome_updated_at (server-stamped only)
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { outcome_updated_at: '2020-01-01' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Invalid segment_tags (not JSON array of strings)
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { segment_tags: [123] });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Invalid status
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { status: 'invalid_status' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Invalid outcome_status
  req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`, 'PATCH', { outcome_status: 'unknown_outcome' });
  res = await patchStaff({ request: req, env });
  assert.equal(res.status, 400);
});

test('(e) PATCH valid update returns 200, updates DB, records audit log caregiver.update', async () => {
  const caregiverId = 'cg_seed_fictional';

  const req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}`,
    'PATCH',
    {
      first_name: 'Janet',
      phone: '555-4321',
      segment_tags: ['carer', 'advocate']
    },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );

  const res = await patchStaff({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.profile.first_name, 'Janet');
  assert.equal(data.profile.phone, '555-4321');
  assert.equal(data.profile.segment_tags, JSON.stringify(['carer', 'advocate']));

  // Check DB state
  const row = raw.prepare("SELECT * FROM caregiver WHERE id = ?").get(caregiverId);
  assert.equal(row.first_name, 'Janet');
  assert.equal(row.phone, '555-4321');

  // Check audit log
  const audit = raw.prepare(`
    SELECT * FROM audit_log
    WHERE action = 'caregiver.update' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(caregiverId);
  assert.ok(audit, 'audit row recorded');
  assert.equal(audit.actor, 'staff@legacy-hub.org');
  assert.equal(audit.entity, 'caregiver');
  const before = JSON.parse(audit.before_json);
  const after = JSON.parse(audit.after_json);
  assert.equal(before.first_name, 'Jane');
  assert.equal(after.first_name, 'Janet');
});

test('(f) PATCH outcome field change stamps outcome_updated_at', async () => {
  const caregiverId = 'cg_seed_fictional';

  // Initial outcome_updated_at is null
  let row = raw.prepare("SELECT outcome_updated_at FROM caregiver WHERE id = ?").get(caregiverId);
  assert.equal(row.outcome_updated_at, null);

  const req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}`,
    'PATCH',
    {
      outcome_status: 'improving',
      outcome_notes: 'Participating actively in respite sessions'
    },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );

  const res = await patchStaff({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.profile.outcome_status, 'improving');
  assert.equal(data.profile.outcome_notes, 'Participating actively in respite sessions');
  assert.ok(data.profile.outcome_updated_at, 'outcome_updated_at should be stamped');

  row = raw.prepare("SELECT outcome_status, outcome_notes, outcome_updated_at FROM caregiver WHERE id = ?").get(caregiverId);
  assert.equal(row.outcome_status, 'improving');
  assert.equal(row.outcome_notes, 'Participating actively in respite sessions');
  assert.ok(row.outcome_updated_at, 'DB outcome_updated_at should be populated');
});

test('(g) POST /api/staff/caregiver/:id/contact appends contact entry with recorded_by from getActor, writes audit log, rejects body-supplied recorded_by/actor with 400', async () => {
  const caregiverId = 'cg_seed_fictional';

  // Rejects body-supplied recorded_by
  let req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}/contact`,
    'POST',
    {
      occurred_at: '2026-09-20T14:30:00Z',
      channel: 'phone',
      direction: 'outbound',
      summary: 'Checking in',
      recorded_by: 'malicious_user'
    },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  let res = await postStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Rejects body-supplied actor
  req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}/contact`,
    'POST',
    {
      occurred_at: '2026-09-20T14:30:00Z',
      channel: 'phone',
      direction: 'outbound',
      summary: 'Checking in',
      actor: 'malicious_actor'
    },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  res = await postStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Rejects invalid channel
  req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}/contact`,
    'POST',
    {
      occurred_at: '2026-09-20T14:30:00Z',
      channel: 'telepathy',
      direction: 'outbound',
      summary: 'Checking in'
    },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  res = await postStaff({ request: req, env });
  assert.equal(res.status, 400);

  // Valid contact submission
  req = mockRequest(
    `http://localhost/api/staff/caregiver/${caregiverId}/contact`,
    'POST',
    {
      occurred_at: '2026-09-20T14:30:00Z',
      channel: 'phone',
      direction: 'outbound',
      summary: 'Phone call regarding grant application next steps'
    },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );
  res = await postStaff({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.contact.caregiver_id, caregiverId);
  assert.equal(data.contact.recorded_by, 'coordinator@legacy-hub.org');
  assert.equal(data.contact.channel, 'phone');
  assert.equal(data.contact.direction, 'outbound');
  assert.equal(data.contact.summary, 'Phone call regarding grant application next steps');

  // Verify in contact_history table
  const dbContact = raw.prepare("SELECT * FROM contact_history WHERE caregiver_id = ?").get(caregiverId);
  assert.ok(dbContact);
  assert.equal(dbContact.recorded_by, 'coordinator@legacy-hub.org');
  assert.equal(dbContact.summary, 'Phone call regarding grant application next steps');

  // Verify audit log
  const audit = raw.prepare(`
    SELECT * FROM audit_log
    WHERE action = 'caregiver.contact_added' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(caregiverId);
  assert.ok(audit);
  assert.equal(audit.actor, 'coordinator@legacy-hub.org');
  assert.equal(audit.entity, 'caregiver');
});

test('(h) GET /api/staff/caregiver/:id returns all existing keys plus contact_history and outcome columns', async () => {
  const caregiverId = 'cg_seed_fictional';

  // Seed two contact entries with different dates
  raw.prepare(`
    INSERT INTO contact_history (caregiver_id, occurred_at, channel, direction, summary, recorded_by, created_at)
    VALUES
      ('${caregiverId}', '2026-09-10T10:00:00Z', 'email', 'inbound', 'First question', 'staff1', '2026-09-10 10:00:00'),
      ('${caregiverId}', '2026-09-15T15:00:00Z', 'phone', 'outbound', 'Followup discussion', 'staff2', '2026-09-15 15:00:00')
  `).run();

  // Set outcome fields
  raw.prepare(`
    UPDATE caregiver
    SET outcome_status = 'stable', outcome_notes = 'Doing well', outcome_updated_at = '2026-09-16 12:00:00'
    WHERE id = ?
  `).run(caregiverId);

  const req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`);
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);

  // Existing keys preserved
  assert.ok(data.profile, 'has profile');
  assert.ok(Array.isArray(data.registrations), 'has registrations array');
  assert.ok(Array.isArray(data.grants), 'has grants array');
  assert.ok(Array.isArray(data.followups), 'has followups array');
  assert.ok(Array.isArray(data.notes), 'has notes array');

  // New key present
  assert.ok(Array.isArray(data.contact_history), 'has contact_history array');
  assert.equal(data.contact_history.length, 2);

  // Ordered newest first (occurred_at DESC)
  assert.equal(data.contact_history[0].summary, 'Followup discussion');
  assert.equal(data.contact_history[1].summary, 'First question');

  // Outcome columns in profile
  assert.equal(data.profile.outcome_status, 'stable');
  assert.equal(data.profile.outcome_notes, 'Doing well');
  assert.equal(data.profile.outcome_updated_at, '2026-09-16 12:00:00');
});
