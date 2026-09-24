// Tests for LEGACY-D7-S2A-EVENTS-BY-CHAT-R1 (Issue #112)
// Comprehensive hermetic test suite for event domain operations, transitions,
// registration guards, audit rows, REST endpoints, public visibility,
// governed agent draft/confirm pipeline with drift checks, and UI wiring.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import * as eventsDomain from '../functions/_lib/domain/events.js';
import { onRequestGet as getStaff, onRequestPost as postStaff, onRequestPatch as patchStaff } from '../functions/api/staff/[[path]].js';
import { onRequestGet as getEvents } from '../functions/api/events.js';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { mapRequestToWorkflowChange } from '../functions/api/agent/_mapper.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_2 = readFileSync(new URL('../schema/0002_seed_public_events.sql', import.meta.url), 'utf8');
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

  if (area === 'event') {
    if (request.includes('create invalid type')) {
      return { ok: true, operation: 'create', payload: { title: 'Invalid Event', type: 'concert', starts_at: '2026-10-15 10:00' } };
    }
    if (request.includes('create support group')) {
      return {
        ok: true,
        operation: 'create',
        payload: {
          title: 'Dementia Caregiver Circle',
          type: 'support_group',
          starts_at: '2026-10-20 14:00',
          ends_at: '2026-10-20 16:00',
          location: 'Conference Room B',
          capacity: 15,
          recurring: false
        }
      };
    }
    if (request.includes('update location')) {
      return {
        ok: true,
        operation: 'update',
        payload: {
          location: 'Main Community Hall',
          capacity: 25
        }
      };
    }
    if (request.includes('publish event')) {
      return { ok: true, operation: 'publish', payload: {} };
    }
    if (request.includes('archive without override')) {
      return { ok: true, operation: 'archive', payload: {} };
    }
    if (request.includes('archive with override')) {
      return { ok: true, operation: 'archive', payload: { confirm_with_registrations: true } };
    }
    return { ok: false, refusal: 'Unknown event operation' };
  }

  return { ok: false, refusal: `Unsupported area: ${area}` };
};

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_2);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_6);
  raw.exec(SCHEMA_7);
  raw.exec(SCHEMA_8);

  env = {
    LEGACY_DB: d1(raw),
    AGENT_MAPPER_BACKEND: mockWorkflowBackend,
    ALLOW_DEV_CONSOLE: '1'
  };
});

// --------------------------------------------------------------------------
// 1. Domain Validation Unit Tests
// --------------------------------------------------------------------------

test('Domain validate: rejects unsupported operations', async () => {
  const res = await eventsDomain.validate(env.LEGACY_DB, {
    operation: 'destroy',
    payload: {}
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /unsupported operation/);
});

test('Domain validate create: rejects missing title, invalid type, invalid dates, capacity <= 0', async () => {
  const db = env.LEGACY_DB;

  // Missing title
  let res = await eventsDomain.validate(db, {
    operation: 'create',
    payload: { type: 'support_group', starts_at: '2026-11-01 10:00' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /title is required/);

  // Invalid type
  res = await eventsDomain.validate(db, {
    operation: 'create',
    payload: { title: 'Test', type: 'concert', starts_at: '2026-11-01 10:00' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /type must be one of/);

  // Invalid starts_at
  res = await eventsDomain.validate(db, {
    operation: 'create',
    payload: { title: 'Test', type: 'support_group', starts_at: 'not-a-date' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /starts_at must be a valid date/);

  // ends_at before starts_at
  res = await eventsDomain.validate(db, {
    operation: 'create',
    payload: {
      title: 'Test',
      type: 'support_group',
      starts_at: '2026-11-01 14:00',
      ends_at: '2026-11-01 12:00'
    }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /ends_at cannot be earlier than starts_at/);

  // capacity <= 0
  res = await eventsDomain.validate(db, {
    operation: 'create',
    payload: {
      title: 'Test',
      type: 'support_group',
      starts_at: '2026-11-01 14:00',
      capacity: 0
    }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /capacity must be an integer >= 1/);
});

test('Domain validate update: rejects non-existent event, id update, and forbidden fields', async () => {
  const db = env.LEGACY_DB;

  // Non-existent event
  let res = await eventsDomain.validate(db, {
    id: 'ev_nonexistent_999',
    operation: 'update',
    payload: { title: 'Updated Title' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);

  // Attempt to modify id
  res = await eventsDomain.validate(db, {
    id: 'ev_memory_social_jul18',
    operation: 'update',
    payload: { id: 'ev_new_id' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /updating event id is not permitted/);

  // Unknown fields
  res = await eventsDomain.validate(db, {
    id: 'ev_memory_social_jul18',
    operation: 'update',
    payload: { sponsor_secret: 'hidden' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /forbidden field/);
});

test('Domain validate publish: 404 for missing event, 409 for non-draft event', async () => {
  const db = env.LEGACY_DB;

  // Missing event
  let res = await eventsDomain.validate(db, {
    id: 'ev_does_not_exist',
    operation: 'publish',
    payload: {}
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);

  // Already published event
  res = await eventsDomain.validate(db, {
    id: 'ev_memory_social_jul18',
    operation: 'publish',
    payload: {}
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.error, /cannot publish from status published/);
});

test('Domain validate archive: 404 missing, 409 already archived, registration guard refusal and override', async () => {
  const db = env.LEGACY_DB;

  // Missing
  let res = await eventsDomain.validate(db, {
    id: 'ev_missing_archive',
    operation: 'archive',
    payload: {}
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);

  // Add registration to ev_virtual_support_group
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_guard_1', 'Sarah', 'sarah@example.org')`).run();
  raw.prepare(`INSERT INTO registration (caregiver_id, event_id, status, source) VALUES ('cg_guard_1', 'ev_virtual_support_group', 'registered', 'staff')`).run();

  // Guard refusal without override
  res = await eventsDomain.validate(db, {
    id: 'ev_virtual_support_group',
    operation: 'archive',
    payload: {}
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.registration_count, 1);
  assert.match(res.error, /registration\(s\)/);

  // Guard override with confirm_with_registrations
  res = await eventsDomain.validate(db, {
    id: 'ev_virtual_support_group',
    operation: 'archive',
    payload: { confirm_with_registrations: true }
  });
  assert.equal(res.ok, true);
});

// --------------------------------------------------------------------------
// 2. Domain Apply Unit Tests (Slug, Draft, Collision, Audit Rows)
// --------------------------------------------------------------------------

test('Domain apply create: creates draft event with slugified ev_<slug>, collision check, and audit row', async () => {
  const db = env.LEGACY_DB;
  const actor = 'staff_lead@example.org';

  const res = await eventsDomain.apply(db, {
    operation: 'create',
    payload: {
      title: 'Art Therapy & Music Workshop',
      type: 'wellness',
      starts_at: '2026-11-15 10:00',
      ends_at: '2026-11-15 12:30',
      location: 'Studio Room',
      capacity: 18,
      recurring: true
    }
  }, actor);

  assert.equal(res.ok, true);
  assert.equal(res.event.id, 'ev_art_therapy_music_workshop');
  assert.equal(res.event.publish_state, 'draft');
  assert.equal(res.event.capacity, 18);
  assert.equal(res.event.recurring, 1);

  // Check audit log
  const auditRow = raw.prepare(`
    SELECT * FROM audit_log WHERE entity_id = ? AND action = 'event.create'
  `).get(res.event.id);
  assert.ok(auditRow);
  assert.equal(auditRow.entity, 'event');
  assert.equal(auditRow.actor, actor);
  assert.deepEqual(JSON.parse(auditRow.before_json), {});
  const afterData = JSON.parse(auditRow.after_json);
  assert.equal(afterData.title, 'Art Therapy & Music Workshop');
  assert.equal(afterData.publish_state, 'draft');

  // Attempt duplicate create -> 409 collision
  const collisionRes = await eventsDomain.apply(db, {
    operation: 'create',
    payload: {
      title: 'Art Therapy & Music Workshop',
      type: 'wellness',
      starts_at: '2026-11-15 10:00'
    }
  }, actor);
  assert.equal(collisionRes.ok, false);
  assert.equal(collisionRes.status, 409);
  assert.match(collisionRes.error, /already exists/);
});

test('Domain apply update: updates allow-listed fields and logs before/after audit row', async () => {
  const db = env.LEGACY_DB;
  const actor = 'updater@example.org';

  const res = await eventsDomain.apply(db, {
    id: 'ev_memory_social_jul18',
    operation: 'update',
    payload: {
      location: 'Updated Garden Pavilion',
      capacity: 35
    }
  }, actor);

  assert.equal(res.ok, true);
  assert.equal(res.event.location, 'Updated Garden Pavilion');
  assert.equal(res.event.capacity, 35);

  const auditRow = raw.prepare(`
    SELECT * FROM audit_log WHERE entity_id = 'ev_memory_social_jul18' AND action = 'event.update'
    ORDER BY id DESC LIMIT 1
  `).get();
  assert.ok(auditRow);
  assert.equal(auditRow.actor, actor);
  const beforeData = JSON.parse(auditRow.before_json);
  const afterData = JSON.parse(auditRow.after_json);
  assert.notEqual(beforeData.location, afterData.location);
  assert.equal(afterData.location, 'Updated Garden Pavilion');
  assert.equal(afterData.capacity, 35);
});

test('Domain apply publish: transitions draft to published with audit log', async () => {
  const db = env.LEGACY_DB;
  const actor = 'publisher@example.org';

  // First create a draft
  const createRes = await eventsDomain.apply(db, {
    operation: 'create',
    payload: {
      title: 'Morning Yoga for Caregivers',
      type: 'wellness',
      starts_at: '2026-12-01 09:00'
    }
  }, actor);
  assert.equal(createRes.ok, true);
  const eventId = createRes.event.id;
  assert.equal(createRes.event.publish_state, 'draft');

  // Now publish it
  const pubRes = await eventsDomain.apply(db, {
    id: eventId,
    operation: 'publish',
    payload: {}
  }, actor);
  assert.equal(pubRes.ok, true);
  assert.equal(pubRes.event.publish_state, 'published');

  const auditRow = raw.prepare(`
    SELECT * FROM audit_log WHERE entity_id = ? AND action = 'event.publish'
  `).get(eventId);
  assert.ok(auditRow);
  const before = JSON.parse(auditRow.before_json);
  const after = JSON.parse(auditRow.after_json);
  assert.equal(before.publish_state, 'draft');
  assert.equal(after.publish_state, 'published');
});

test('Domain apply archive: soft-deletes and captures registration_count in audit log', async () => {
  const db = env.LEGACY_DB;
  const actor = 'archiver@example.org';

  // Seed registration on ev_wellness_grant_info_aug01
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_arch_1', 'David', 'david@example.org')`).run();
  raw.prepare(`INSERT INTO registration (caregiver_id, event_id, status, source) VALUES ('cg_arch_1', 'ev_wellness_grant_info_aug01', 'registered', 'staff')`).run();

  const archRes = await eventsDomain.apply(db, {
    id: 'ev_wellness_grant_info_aug01',
    operation: 'archive',
    payload: { confirm_with_registrations: true }
  }, actor);

  assert.equal(archRes.ok, true);
  assert.equal(archRes.event.publish_state, 'archived');

  const auditRow = raw.prepare(`
    SELECT * FROM audit_log WHERE entity_id = 'ev_wellness_grant_info_aug01' AND action = 'event.archive'
  `).get();
  assert.ok(auditRow);
  const after = JSON.parse(auditRow.after_json);
  assert.equal(after.publish_state, 'archived');
  assert.equal(after.registration_count, 1);
});

// --------------------------------------------------------------------------
// 3. Staff REST Routes
// --------------------------------------------------------------------------

test('Staff REST: GET /api/staff/events returns all events with registration count', async () => {
  const req = new Request('http://localhost/api/staff/events', {
    method: 'GET',
    headers: { 'x-dev-actor': 'staff@example.org' }
  });
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.events));
  assert.ok(data.events.length >= 4);

  // Each item has registered_count and publish_state
  const ev = data.events.find(e => e.id === 'ev_memory_social_jul18');
  assert.ok(ev);
  assert.equal(ev.publish_state, 'published');
  assert.equal(typeof ev.registered_count, 'number');
});

test('Staff REST: POST /api/staff/event creates draft event and returns 201', async () => {
  const req = new Request('http://localhost/api/staff/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_writer@example.org' },
    body: JSON.stringify({
      title: 'Restorative Meditation',
      type: 'wellness',
      starts_at: '2026-11-20 18:00',
      location: 'Quiet Room',
      capacity: 10
    })
  });
  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.event.id, 'ev_restorative_meditation');
  assert.equal(data.event.publish_state, 'draft');
});

test('Staff REST: PATCH /api/staff/event/:id updates fields', async () => {
  const req = new Request('http://localhost/api/staff/event/ev_memory_social_jul18', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_editor@example.org' },
    body: JSON.stringify({
      location: 'Community Room East Wing'
    })
  });
  const res = await patchStaff({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.event.location, 'Community Room East Wing');
});

test('Staff REST: POST /api/staff/event/:id/publish publishes draft', async () => {
  // Create draft first
  await eventsDomain.apply(env.LEGACY_DB, {
    operation: 'create',
    payload: {
      title: 'Caregiver Support Breakfast',
      type: 'support_group',
      starts_at: '2026-12-05 08:30'
    }
  }, 'staff@example.org');

  const req = new Request('http://localhost/api/staff/event/ev_caregiver_support_breakfast/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_lead@example.org' }
  });
  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.event.publish_state, 'published');
});

test('Staff REST: POST /api/staff/event/:id/archive guards against active registrations', async () => {
  // Add active registration to ev_memory_social_caregiver_aug15
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_rest_1', 'Anna', 'anna@example.org')`).run();
  raw.prepare(`INSERT INTO registration (caregiver_id, event_id, status, source) VALUES ('cg_rest_1', 'ev_memory_social_caregiver_aug15', 'registered', 'staff')`).run();

  // Try archive without confirm -> 409
  const req1 = new Request('http://localhost/api/staff/event/ev_memory_social_caregiver_aug15/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({})
  });
  const res1 = await postStaff({ request: req1, env });
  assert.equal(res1.status, 409);
  const data1 = await res1.json();
  assert.equal(data1.ok, false);
  assert.equal(data1.registration_count, 1);

  // Try archive with confirm -> 200
  const req2 = new Request('http://localhost/api/staff/event/ev_memory_social_caregiver_aug15/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff@example.org' },
    body: JSON.stringify({ confirm_with_registrations: true })
  });
  const res2 = await postStaff({ request: req2, env });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.event.publish_state, 'archived');
});

// --------------------------------------------------------------------------
// 4. Public API Visibility via GET /api/events
// --------------------------------------------------------------------------

test('Public visibility: GET /api/events omits draft and archived events', async () => {
  // 1. Create a draft event
  await eventsDomain.apply(env.LEGACY_DB, {
    operation: 'create',
    payload: {
      title: 'Secret Draft Gathering',
      type: 'other',
      starts_at: '2026-12-12 12:00'
    }
  }, 'staff@example.org');

  // 2. Archive an existing published event
  await eventsDomain.apply(env.LEGACY_DB, {
    id: 'ev_virtual_support_group',
    operation: 'archive',
    payload: {}
  }, 'staff@example.org');

  // 3. Query public endpoint
  const pubRes = await getEvents({ env });
  assert.equal(pubRes.status, 200);
  const data = await pubRes.json();
  assert.equal(data.ok, true);

  const ids = data.events.map(e => e.id);
  // Draft omitted
  assert.ok(!ids.includes('ev_secret_draft_gathering'));
  // Archived omitted
  assert.ok(!ids.includes('ev_virtual_support_group'));
  // Published retained
  assert.ok(ids.includes('ev_memory_social_jul18'));
});

// --------------------------------------------------------------------------
// 5. Governed Agent Pipeline (Draft, Confirm, Double Audit, Drift Refusal)
// --------------------------------------------------------------------------

test('Agent pipeline: draft writes nothing to event table', async () => {
  const req = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_agent@example.org' },
    body: JSON.stringify({
      area: 'event',
      target_id: 'new',
      request: 'create support group for dementia caregivers'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.change_id);
  assert.equal(data.change.operation, 'create');
  assert.equal(data.change.payload.title, 'Dementia Caregiver Circle');

  // Verify NOTHING was written to event table
  const checkRow = raw.prepare(`SELECT * FROM event WHERE title = 'Dementia Caregiver Circle'`).get();
  assert.equal(checkRow, undefined);
});

test('Agent pipeline: confirm applies domain event change and double-audits', async () => {
  // Step 1: Draft
  const draftReq = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_agent@example.org' },
    body: JSON.stringify({
      area: 'event',
      target_id: 'new',
      request: 'create support group for dementia caregivers'
    })
  });
  const draftRes = await postAgent({ request: draftReq, env });
  const { change_id } = await draftRes.json();

  // Step 2: Confirm
  const confirmReq = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_agent@example.org' },
    body: JSON.stringify({ change_id })
  });
  const confirmRes = await postAgent({ request: confirmReq, env });
  assert.equal(confirmRes.status, 200);
  const confirmData = await confirmRes.json();
  assert.equal(confirmData.ok, true);

  // Check event table
  const eventRow = raw.prepare(`SELECT * FROM event WHERE id = 'ev_dementia_caregiver_circle'`).get();
  assert.ok(eventRow);
  assert.equal(eventRow.publish_state, 'draft');

  // Check agent_change record
  const agentChangeRow = raw.prepare(`SELECT * FROM agent_change WHERE id = ?`).get(change_id);
  assert.ok(agentChangeRow);
  assert.equal(agentChangeRow.status, 'published');

  // Check audit_log record
  const auditRow = raw.prepare(`SELECT * FROM audit_log WHERE entity_id = 'ev_dementia_caregiver_circle' AND action = 'event.create'`).get();
  assert.ok(auditRow);
  assert.equal(auditRow.entity, 'event');
});

test('Agent pipeline: drift refusal if event is modified before confirm', async () => {
  // Step 1: Draft an update to ev_memory_social_jul18
  const draftReq = new Request('http://localhost/api/agent/change/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_agent@example.org' },
    body: JSON.stringify({
      area: 'event',
      target_id: 'ev_memory_social_jul18',
      request: 'update location'
    })
  });
  const draftRes = await postAgent({ request: draftReq, env });
  const { change_id } = await draftRes.json();

  // Step 2: Direct drift modification in database behind agent's back
  raw.prepare(`
    UPDATE event SET location = 'Intervening Mutation Hall', updated_at = datetime('now', '+1 hour')
    WHERE id = 'ev_memory_social_jul18'
  `).run();

  // Step 3: Confirm should detect drift and refuse with 409
  const confirmReq = new Request('http://localhost/api/agent/change/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-actor': 'staff_agent@example.org' },
    body: JSON.stringify({ change_id })
  });
  const confirmRes = await postAgent({ request: confirmReq, env });
  assert.equal(confirmRes.status, 409);
  const confirmData = await confirmRes.json();
  assert.equal(confirmData.ok, false);
  assert.match(confirmData.error, /record changed underneath/i);
});

// --------------------------------------------------------------------------
// 6. UI Wiring, CSP, and Styling Compliance
// --------------------------------------------------------------------------

test('UI wiring: staff console has event chat area option and new event form', () => {
  assert.match(STAFF_HTML, /<option\s+value="event">Event<\/option>/);
  assert.match(STAFF_HTML, /id="newEventToggleBtn"/);
  assert.match(STAFF_HTML, /id="newEventContainer"/);
  assert.match(STAFF_HTML, /id="editEventContainer"/);
  assert.match(STAFF_JS, /id="newEventForm"/);
  assert.match(STAFF_JS, /name="title"/);
  assert.match(STAFF_JS, /name="type"/);
  assert.match(STAFF_JS, /name="starts_at"/);
  assert.match(STAFF_JS, /name="ends_at"/);
  assert.match(STAFF_JS, /name="location"/);
  assert.match(STAFF_JS, /name="capacity"/);
  assert.match(STAFF_JS, /name="recurring"/);
  assert.match(STAFF_JS, /data-action="submit-create-event"/);
  assert.match(STAFF_JS, /data-action="cancel-new-event"/);
});

test('UI styling: new event elements have ZERO inline styles or inline handlers', () => {
  const newEventSectionMatch = STAFF_HTML.match(/<div class="panel" id="eventsPanel">([\s\S]*?)<\/table>/);
  assert.ok(newEventSectionMatch, 'eventsPanel found in staff.html');
  const sectionContent = newEventSectionMatch[1];

  assert.doesNotMatch(sectionContent, /\bstyle\s*=/i, 'No inline style attributes in events panel HTML');
  assert.doesNotMatch(sectionContent, /\bon[a-z]+\s*=/i, 'No inline event handlers in events panel HTML');
});

test('UI styling: styles.css contains required event badge classes', () => {
  assert.match(STYLES_CSS, /\.badge-draft/);
  assert.match(STYLES_CSS, /\.badge-published/);
  assert.match(STYLES_CSS, /\.badge-archived/);
  assert.match(STYLES_CSS, /\.event-actions/);
});

test('UI behavior: staff.js contains event actions and data-action delegation', () => {
  assert.match(STAFF_JS, /loadEvents/);
  assert.match(STAFF_JS, /publish-event/);
  assert.match(STAFF_JS, /archive-event/);
  assert.match(STAFF_JS, /edit-event/);
  assert.match(STAFF_JS, /submit-create-event/);
  assert.match(STAFF_JS, /submit-edit-event/);
});

test('Agent mapper: gatewayWorkflowBackend constructs event tools and parses response', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'propose_event_create',
                    arguments: JSON.stringify({
                      title: 'Respite Day Out',
                      type: 'caregiver_event',
                      starts_at: '2026-11-28 10:00'
                    })
                  }
                }
              ]
            }
          }
        ]
      })
    };
  };

  try {
    const res = await mapRequestToWorkflowChange({
      area: 'event',
      target_id: 'new',
      request: 'add a respite day out event',
      current: null,
      gatewayUrl: 'http://mock-gateway/v1/chat/completions',
      gatewayKey: 'dummy-key'
    });

    assert.equal(res.ok, true);
    assert.equal(res.operation, 'create');
    assert.equal(res.payload.title, 'Respite Day Out');

    const toolNames = capturedBody.tools.map(t => t.function.name);
    assert.ok(toolNames.includes('propose_event_create'));
    assert.ok(toolNames.includes('propose_event_update'));
    assert.ok(toolNames.includes('propose_event_publish'));
    assert.ok(toolNames.includes('propose_event_archive'));
    assert.ok(toolNames.includes('refuse_request'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

