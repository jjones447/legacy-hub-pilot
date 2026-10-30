import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getStaff, onRequestPost as postStaff, onRequestPatch as patchStaff } from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const SCHEMA_11 = readFileSync(new URL('../schema/0011_staff_member.sql', import.meta.url), 'utf8');
const SCHEMA_17 = readFileSync(new URL('../schema/0017_event_details.sql', import.meta.url), 'utf8');

function d1(db) {
  return {
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
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
      if (!body) throw new Error('no body');
      return body;
    },
    async text() {
      if (typeof body === 'string') return body;
      return JSON.stringify(body || {});
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
  env = { LEGACY_DB: d1(raw) };

  // Seed an open followup for testing
  raw.prepare(`
    INSERT OR IGNORE INTO followup (id, caregiver_id, kind, detail, status, source, external_ref)
    VALUES (1001, 'cg_seed_fictional', 'support_request', 'Need respite help', 'open', 'seed', 'ref_fu_001')
  `).run();
});

async function changeLog() {
  const response = await getStaff({ request: mockRequest('https://synthetic.invalid/api/staff/recent-changes'), env });
  assert.equal(response.status, 200);
  return response.json();
}

const CHANGE_LOG_WORKFLOWS = [
  ['event.create', 'event'], ['event.update', 'event'], ['event.publish', 'event'],
  ['event.unpublish', 'event'], ['event.archive', 'event'],
  ['staff.created', 'staff_member'], ['staff.updated', 'staff_member'], ['staff.first_sign_in', 'staff_member'],
];

test('change log includes event and staff workflows, preserves provenance and never offers unsupported undo', async () => {
  const insert = raw.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json, at)
    VALUES ('fictional-editor@synthetic.invalid', ?, ?, 'fictional-target', ?, ?, ?)`);
  const ids = CHANGE_LOG_WORKFLOWS.map(([action, entity], index) => Number(insert.run(
    action, entity, '{"original":"before"}', '{"original":"after"}', `2026-10-${String(index + 1).padStart(2, '0')} 12:00:00`,
  ).lastInsertRowid));
  insert.run('caregiver.update', 'caregiver', '{"first_name":"Before"}', '{"first_name":"After"}', '2026-07-01 00:00:00');
  insert.run('content_item.publish', 'content_item', '{"status":"draft"}', '{"status":"published"}', '2026-07-01 00:00:00');
  for (const [action, entity] of [['portal.login', 'caregiver'], ['staff.secret_diagnostic', 'staff_member'],
    ['event.private_diagnostic', 'event'], ['staff.updated', 'unrelated'], ['event.publish', 'unrelated']]) {
    insert.run(action, entity, null, '{"private":"not-a-change-log-workflow"}', '2026-10-27 12:00:00');
  }
  const original = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  const data = await changeLog();
  assert.deepEqual(data.changes, data.recent_changes);
  assert.equal(data.changes.length, 10);
  for (const id of ids) {
    const entry = data.changes.find(row => row.id === id);
    assert.ok(entry, `missing workflow ${original.find(row => row.id === id).action}`);
    const { restorable, can_undo, is_undone, ...persisted } = entry;
    assert.deepEqual(persisted, { ...original.find(row => row.id === id) });
    assert.equal(restorable, false);
    assert.equal(can_undo, false);
    assert.equal(is_undone, false);
    assert.equal((await postStaff({ request: contentUndoRequest(id), env })).status, 409);
  }
  assert.ok(data.changes.filter(row => ['caregiver', 'content_item'].includes(row.entity)).every(row => row.restorable));
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), original);
});

test('actual event create/publish and unchanged staff Save audit appear immediately in change log', async () => {
  raw.exec(SCHEMA_11.split('-- The people already')[0]);
  raw.exec(SCHEMA_17);
  raw.exec(readFileSync(new URL('../schema/0018_event_photos.sql', import.meta.url), 'utf8'));
  raw.prepare("INSERT INTO staff_member (email, display_name, role) VALUES ('staff@example.org', 'Fictional Admin', 'admin')").run();
  const headers = { 'Cf-Access-Jwt-Assertion': 'header.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.signature' };
  // Existing handler-unit actor seam only, not actual Access middleware authentication.
  const created = await postStaff({ request: mockRequest('https://synthetic.invalid/api/staff/event', 'POST', {
    id: 'ev_fictional_log', title: 'FICTIONAL SOURCE TEST', type: 'other', starts_at: '2026-10-29T15:00:00Z',
  }, headers), env });
  assert.equal(created.status, 201);
  assert.equal((await postStaff({ request: mockRequest('https://synthetic.invalid/api/staff/event/ev_fictional_log/publish', 'POST', {}, headers), env })).status, 200);
  assert.equal((await patchStaff({ request: mockRequest('https://synthetic.invalid/api/staff/team', 'PATCH', {
    email: 'staff@example.org', display_name: 'Fictional Admin',
  }, headers), env })).status, 200);
  const original = raw.prepare('SELECT * FROM audit_log ORDER BY id DESC').all();
  assert.deepEqual(original.map(row => row.action), ['staff.updated', 'event.publish', 'event.create']);
  const data = await changeLog();
  assert.deepEqual(data.changes.map(row => row.id), original.map(row => row.id));
  assert.ok(data.changes.every(row => row.actor === 'staff@example.org' && !row.restorable && !row.can_undo));
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id DESC').all(), original);
});

test('change log keeps insertion-ID newest-first ordering and fifty-row bound without exposing unrelated audit streams', async () => {
  const insert = raw.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, at)
    VALUES ('fictional@synthetic.invalid', ?, ?, ?, ?)`);
  const expected = [];
  for (let i = 0; i < 55; i++) {
    expected.push(Number(insert.run('event.publish', 'event', `ev_fictional_${i}`, i % 2 ? '2026-10-01 00:00:00' : '2020-01-01 00:00:00').lastInsertRowid));
  }
  for (let i = 0; i < 60; i++) insert.run('portal.login', 'caregiver', 'fictional-private-stream', '2099-01-01 00:00:00');
  const original = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  const data = await changeLog();
  assert.deepEqual(data.changes.map(row => row.id), expected.reverse().slice(0, 50));
  assert.ok(data.changes.every(row => row.entity === 'event' && !row.can_undo));
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), original);
});

test('GET /api/staff/queue returns open followups with caregiver names', async () => {
  // Maria Gonzalez (cg_seed_fictional) is seeded with an open followup
  const req = mockRequest('http://localhost/api/staff/queue');
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(data.queue);
  assert.equal(data.queue.length, 1);
  assert.equal(data.queue[0].caregiver_first_name, 'Jane'); // cg_seed_fictional is Jane in 0003 seed
  assert.equal(data.queue[0].status, 'open');
});

test('GET /api/staff/caregiver/:id aggregates caregiver record data', async () => {
  const caregiverId = 'cg_seed_fictional';
  const req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`);
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.profile.id, caregiverId);
  assert.equal(data.profile.first_name, 'Jane');
  assert.ok(Array.isArray(data.registrations));
  assert.ok(Array.isArray(data.grants));
  assert.ok(Array.isArray(data.followups));
  assert.ok(Array.isArray(data.notes));
});

test('GET /api/staff/caregiver/:id returns 404 for unknown caregiver', async () => {
  const req = mockRequest('http://localhost/api/staff/caregiver/cg_unknown');
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 404);
});

test('POST /api/staff/followup/:id/resolve resolves followup with audit log and actor email', async () => {
  // Seed has followup id = 1001 (open)
  const req = mockRequest(
    'http://localhost/api/staff/followup/1001/resolve',
    'POST',
    { status: 'done' },
    { 'Cf-Access-Jwt-Assertion': 'header.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.signature' } // mock base64 email: staff@example.org
  );

  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);

  const fu = raw.prepare(`SELECT status FROM followup WHERE id = 1001`).get();
  assert.equal(fu.status, 'done');

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity_id = '1001'`).get();
  assert.ok(audit);
  assert.equal(audit.actor, 'staff@example.org');
  assert.equal(audit.action, 'followup.resolve');
});

test('POST /api/staff/followup/:id/resolve fails with 409 for already resolved followup', async () => {
  // Set followup 1001 to done first
  raw.prepare(`UPDATE followup SET status = 'done' WHERE id = 1001`).run();

  const req = mockRequest(
    'http://localhost/api/staff/followup/1001/resolve',
    'POST',
    { status: 'done' },
    { 'x-dev-actor': 'test_dev@example.org' }
  );

  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 409);
});

function seedContentUndo(beforeKind = 'publish') {
  const oldData = { paragraphs: ['Original fictional copy'], heading: 'Keep this field' };
  const newData = { ...oldData, paragraphs: ['Changed fictional copy'] };
  const before = beforeKind === 'publish' ? { status: 'draft', data: oldData }
    : beforeKind === 'data-only' ? { data: oldData } : oldData;
  const after = { status: 'published', data: newData };
  raw.prepare('INSERT INTO content_type (id, json_schema) VALUES (?, ?)')
    .run('page_section', '{}');
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by, updated_at)
    VALUES (?, 'page_section', ?, 'published', 'staff_editor@example.org', '2026-01-01 00:00:00')
  `).run('ps_fictional_undo', JSON.stringify(newData));
  const inserted = raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('editor@example.org', 'content_item.publish', 'content_item', ?, ?, ?)
  `).run('ps_fictional_undo', JSON.stringify(before), JSON.stringify(after));
  return {
    auditId: Number(inserted.lastInsertRowid),
    oldData,
    expectedStatus: beforeKind === 'publish' ? 'draft' : 'published',
    originalRow: raw.prepare('SELECT * FROM content_item WHERE id = ?').get('ps_fictional_undo'),
    originalAudit: raw.prepare('SELECT * FROM audit_log WHERE id = ?').get(Number(inserted.lastInsertRowid))
  };
}

function contentUndoRequest(auditId) {
  return mockRequest(`http://localhost/api/staff/undo/${auditId}`, 'POST', null, {
    // Fictional assertion already accepted by the handler's test-local actor seam;
    // this does not exercise the real Access JWT-verification middleware.
    'Cf-Access-Jwt-Assertion': 'header.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.signature'
  });
}

for (const beforeKind of ['publish', 'data-only', 'legacy-flat']) {
  test(`content undo rollback on audit failure (${beforeKind})`, async () => {
    const fixture = seedContentUndo(beforeKind);
    // A real SQLite statement failure, not a fake transaction success flag.
    raw.exec(`CREATE TRIGGER fail_content_undo_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'undo'
      BEGIN SELECT RAISE(ABORT, 'fictional undo audit failure'); END;`);

    const res = await postStaff({ request: contentUndoRequest(fixture.auditId), env });
    assert.equal(res.status, 500);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'undo'").get().n, 0);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log WHERE id = ?').get(fixture.auditId), fixture.originalAudit);
    // Includes body, status, updater and timestamp: no partial restoration may commit.
    assert.deepEqual(raw.prepare('SELECT * FROM content_item WHERE id = ?').get('ps_fictional_undo'), fixture.originalRow);
  });

  test(`content undo commits restoration and original audit reference (${beforeKind})`, async () => {
    const fixture = seedContentUndo(beforeKind);
    const res = await postStaff({ request: contentUndoRequest(fixture.auditId), env });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, undone_audit_id: fixture.auditId });
    const restored = raw.prepare('SELECT * FROM content_item WHERE id = ?').get('ps_fictional_undo');
    assert.deepEqual(JSON.parse(restored.data), fixture.oldData);
    assert.equal(restored.status, fixture.expectedStatus);
    assert.equal(restored.updated_by, 'staff_staff@example.org');
    assert.notEqual(restored.updated_at, fixture.originalRow.updated_at);
    assert.equal(restored.id, fixture.originalRow.id);
    assert.equal(restored.type_id, fixture.originalRow.type_id);
    const undos = raw.prepare("SELECT * FROM audit_log WHERE action = 'undo'").all();
    assert.equal(undos.length, 1);
    assert.equal(undos[0].actor, 'staff@example.org');
    assert.equal(undos[0].entity, fixture.originalAudit.entity);
    assert.equal(undos[0].entity_id, fixture.originalAudit.entity_id);
    assert.equal(undos[0].before_json, fixture.originalAudit.after_json);
    assert.deepEqual(JSON.parse(undos[0].after_json), {
      original_audit_id: fixture.auditId,
      undone_audit_id: fixture.auditId,
      audit_id: fixture.auditId,
      original_action: fixture.originalAudit.action,
      entity: fixture.originalAudit.entity,
      entity_id: fixture.originalAudit.entity_id
    });
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log WHERE id = ?').get(fixture.auditId), fixture.originalAudit);
  });
}

for (const refusal of ['missing before', 'malformed before', 'non-restorable', 'already undone']) {
  test(`content undo preserves original refusal: ${refusal}`, async () => {
    const fixture = seedContentUndo();
    // Append a case-specific fictional audit; even fixture audits stay append-only.
    if (refusal !== 'already undone') {
      const before = refusal === 'missing before' ? null : refusal === 'malformed before' ? '{bad' : fixture.originalAudit.before_json;
      const action = refusal === 'non-restorable' ? 'content_item.undo' : fixture.originalAudit.action;
      raw.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES ('editor@example.org', ?, 'content_item', 'ps_fictional_undo', ?, ?)`)
        .run(action, before, fixture.originalAudit.after_json);
      fixture.auditId = Number(raw.prepare('SELECT MAX(id) AS id FROM audit_log').get().id);
    } else {
      raw.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES ('staff@example.org', 'undo', 'content_item', 'ps_fictional_undo', NULL, ?)`)
        .run(JSON.stringify({ original_audit_id: fixture.auditId }));
    }
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    const res = await postStaff({ request: contentUndoRequest(fixture.auditId), env });
    assert.equal(res.status, 409);
    assert.deepEqual(raw.prepare('SELECT * FROM content_item WHERE id = ?').get('ps_fictional_undo'), fixture.originalRow);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  });
}

function followupResolveRequest(status, id = '1001') {
  return mockRequest(`http://localhost/api/staff/followup/${id}/resolve`, 'POST', { status }, {
    // Fictional handler-unit actor seam, not real Access middleware verification.
    'Cf-Access-Jwt-Assertion': 'header.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.signature'
  });
}

for (const status of ['done', 'dismissed']) {
  test(`followup resolve rolls back on audit failure (${status})`, async () => {
    const before = raw.prepare('SELECT * FROM followup WHERE id = 1001').get();
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    raw.exec(`CREATE TRIGGER fail_followup_resolve_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'followup.resolve'
      BEGIN SELECT RAISE(ABORT, 'fictional followup audit failure'); END;`);

    const res = await postStaff({ request: followupResolveRequest(status), env });
    assert.equal(res.status, 500);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
    assert.deepEqual(raw.prepare('SELECT * FROM followup WHERE id = 1001').get(), before);
  });

  test(`followup resolve mutation failure leaves no audit (${status})`, async () => {
    const before = raw.prepare('SELECT * FROM followup WHERE id = 1001').get();
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    raw.exec(`CREATE TRIGGER fail_followup_resolve_update BEFORE UPDATE OF status ON followup
      WHEN OLD.id = 1001
      BEGIN SELECT RAISE(ABORT, 'fictional followup mutation failure'); END;`);

    const res = await postStaff({ request: followupResolveRequest(status), env });
    assert.equal(res.status, 500);
    assert.deepEqual(raw.prepare('SELECT * FROM followup WHERE id = 1001').get(), before);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  });

  test(`followup resolve commits only status and its original audit (${status})`, async () => {
    const before = raw.prepare('SELECT * FROM followup WHERE id = 1001').get();
    const res = await postStaff({ request: followupResolveRequest(status), env });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const after = raw.prepare('SELECT * FROM followup WHERE id = 1001').get();
    assert.equal(after.status, status);
    assert.deepEqual({ ...after, status: before.status }, { ...before });
    const audits = raw.prepare("SELECT * FROM audit_log WHERE action = 'followup.resolve'").all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor, 'staff@example.org');
    assert.equal(audits[0].entity, 'followup');
    assert.equal(audits[0].entity_id, '1001');
    assert.deepEqual(JSON.parse(audits[0].before_json), { status: 'open' });
    assert.deepEqual(JSON.parse(audits[0].after_json), { status });
  });
}

test('followup resolve preserves default done status', async () => {
  const res = await postStaff({ request: followupResolveRequest(undefined), env });
  assert.equal(res.status, 200);
  assert.equal(raw.prepare('SELECT status FROM followup WHERE id = 1001').get().status, 'done');
  const audit = raw.prepare("SELECT after_json FROM audit_log WHERE action = 'followup.resolve'").get();
  assert.deepEqual(JSON.parse(audit.after_json), { status: 'done' });
});

for (const scenario of [
  { name: 'invalid ID', id: 'not-an-id', response: 400 },
  { name: 'missing ID', url: 'http://localhost/api/staff/followup/resolve', response: 400 },
  { name: 'unknown ID', id: '999999', response: 404 },
  { name: 'invalid target status', target: 'open', response: 400 },
  { name: 'already done', initial: 'done', response: 409 },
  { name: 'already dismissed', initial: 'dismissed', response: 409 }
]) {
  test(`followup resolve preserves refusal: ${scenario.name}`, async () => {
    if (scenario.initial) raw.prepare('UPDATE followup SET status = ? WHERE id = 1001').run(scenario.initial);
    const before = raw.prepare('SELECT * FROM followup WHERE id = 1001').get();
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    const request = scenario.url ? mockRequest(scenario.url, 'POST', { status: 'done' })
      : followupResolveRequest(scenario.target || 'done', scenario.id || '1001');
    const res = await postStaff({ request, env });
    assert.equal(res.status, scenario.response);
    assert.deepEqual(raw.prepare('SELECT * FROM followup WHERE id = 1001').get(), before);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  });
}
