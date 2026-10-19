// Tests for LEGACY-D2-STAFF-NOTES-R1 (Issue #101)
// Verifies staff note creation, archival, input validation, audit logging,
// read-back filtering, escaping of hostile note bodies, and UI wiring.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  onRequestGet as getStaff,
  onRequestPost as postStaff,
} from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const STYLES_CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

  // Seed sample caregiver
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, status, source)
    VALUES ('cg_note_test', 'Eleanor', 'Vance', 'eleanor@example.com', '555-0199', 'active', 'site_form')
  `).run();
});

test('1. POST /api/staff/caregiver/:id/note creates note (201), author from getActor, writes audit row', async () => {
  const req = mockRequest(
    'https://example.com/api/staff/caregiver/cg_note_test/note',
    'POST',
    { body: 'Caregiver requested followup on respite grant availability next week.' },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );

  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.note.id);
  assert.equal(data.note.caregiver_id, 'cg_note_test');
  assert.equal(data.note.author, 'coordinator@legacy-hub.org');
  assert.equal(data.note.body, 'Caregiver requested followup on respite grant availability next week.');
  assert.equal(data.note.visibility, 'staff');
  assert.equal(data.note.status, 'active');

  // Verify in DB
  const noteRow = raw.prepare('SELECT * FROM note WHERE id = ?').get(data.note.id);
  assert.ok(noteRow);
  assert.equal(noteRow.caregiver_id, 'cg_note_test');
  assert.equal(noteRow.author, 'coordinator@legacy-hub.org');
  assert.equal(noteRow.status, 'active');

  // Verify audit log
  const auditRow = raw.prepare(`
    SELECT * FROM audit_log
    WHERE action = 'caregiver.note_added' AND entity_id = 'cg_note_test'
    ORDER BY id DESC LIMIT 1
  `).get();
  assert.ok(auditRow);
  assert.equal(auditRow.actor, 'coordinator@legacy-hub.org');
  assert.equal(auditRow.entity, 'caregiver');
  const afterData = JSON.parse(auditRow.after_json);
  assert.equal(afterData.note_id, data.note.id);
  assert.equal(afterData.author, 'coordinator@legacy-hub.org');
});

test('2. POST /api/staff/caregiver/:id/note rejects body-supplied author, visibility, status or other extra fields with 400', async () => {
  const badBodies = [
    { body: 'Note text', author: 'attacker' },
    { body: 'Note text', visibility: 'public' },
    { body: 'Note text', status: 'archived' },
    { body: 'Note text', extra_field: 'disallowed' },
  ];

  for (const b of badBodies) {
    const req = mockRequest(
      'https://example.com/api/staff/caregiver/cg_note_test/note',
      'POST',
      b,
      { 'x-dev-actor': 'coordinator@legacy-hub.org' }
    );
    const res = await postStaff({ request: req, env });
    assert.equal(res.status, 400, `Expected 400 for payload: ${JSON.stringify(b)}`);
    const data = await res.json();
    assert.equal(data.ok, false);
  }
});

test('3. POST /api/staff/caregiver/:id/note rejects empty or whitespace-only body with 400', async () => {
  const emptyBodies = [
    { body: '' },
    { body: '   ' },
    { body: '\n\t  ' },
    {}
  ];

  for (const b of emptyBodies) {
    const req = mockRequest(
      'https://example.com/api/staff/caregiver/cg_note_test/note',
      'POST',
      b,
      { 'x-dev-actor': 'coordinator@legacy-hub.org' }
    );
    const res = await postStaff({ request: req, env });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.ok, false);
  }
});

test('4. POST /api/staff/caregiver/:id/note rejects over-length body (>2000 chars) with 400 and admits 2000 chars', async () => {
  // Over 2000 characters
  const tooLong = 'a'.repeat(2001);
  const reqOver = mockRequest(
    'https://example.com/api/staff/caregiver/cg_note_test/note',
    'POST',
    { body: tooLong },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );
  const resOver = await postStaff({ request: reqOver, env });
  assert.equal(resOver.status, 400);

  // Exactly 2000 characters
  const exactMax = 'b'.repeat(2000);
  const reqMax = mockRequest(
    'https://example.com/api/staff/caregiver/cg_note_test/note',
    'POST',
    { body: exactMax },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );
  const resMax = await postStaff({ request: reqMax, env });
  assert.equal(resMax.status, 201);
  const data = await resMax.json();
  assert.equal(data.ok, true);
  assert.equal(data.note.body.length, 2000);
});

test('5. POST /api/staff/caregiver/:id/note returns 404 for unknown caregiver', async () => {
  const req = mockRequest(
    'https://example.com/api/staff/caregiver/cg_nonexistent/note',
    'POST',
    { body: 'A note for nobody' },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );
  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'caregiver not found');
});

test('6. POST /api/staff/note/:id/archive sets status=archived, logs audit, and read back omits the note', async () => {
  // Create a note
  const createReq = mockRequest(
    'https://example.com/api/staff/caregiver/cg_note_test/note',
    'POST',
    { body: 'To be archived shortly' },
    { 'x-dev-actor': 'coordinator@legacy-hub.org' }
  );
  const createRes = await postStaff({ request: createReq, env });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const noteId = created.note.id;

  // Verify GET caregiver returns the active note
  const getReqBefore = mockRequest('https://example.com/api/staff/caregiver/cg_note_test');
  const getResBefore = await getStaff({ request: getReqBefore, env });
  assert.equal(getResBefore.status, 200);
  const dataBefore = await getResBefore.json();
  assert.equal(dataBefore.notes.length, 1);
  assert.equal(dataBefore.notes[0].id, noteId);

  // Archive the note
  const archiveReq = mockRequest(
    `https://example.com/api/staff/note/${noteId}/archive`,
    'POST',
    {},
    { 'x-dev-actor': 'director@legacy-hub.org' }
  );
  const archiveRes = await postStaff({ request: archiveReq, env });
  assert.equal(archiveRes.status, 200);
  const archiveData = await archiveRes.json();
  assert.equal(archiveData.ok, true);

  // Verify DB state
  const noteDb = raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId);
  assert.equal(noteDb.status, 'archived');

  // Verify audit log caregiver.note_archived
  const auditRow = raw.prepare(`
    SELECT * FROM audit_log
    WHERE action = 'caregiver.note_archived' AND entity_id = 'cg_note_test'
    ORDER BY id DESC LIMIT 1
  `).get();
  assert.ok(auditRow);
  assert.equal(auditRow.actor, 'director@legacy-hub.org');
  assert.equal(auditRow.entity, 'caregiver');
  const afterJson = JSON.parse(auditRow.after_json);
  assert.equal(afterJson.note_id, noteId);
  assert.equal(afterJson.status, 'archived');

  // Verify GET caregiver now omits the archived note
  const getReqAfter = mockRequest('https://example.com/api/staff/caregiver/cg_note_test');
  const getResAfter = await getStaff({ request: getReqAfter, env });
  assert.equal(getResAfter.status, 200);
  const dataAfter = await getResAfter.json();
  assert.equal(dataAfter.notes.length, 0);
});

test('7. POST /api/staff/note/:id/archive returns 409 when archiving already archived note', async () => {
  // Create and archive note
  const createReq = mockRequest(
    'https://example.com/api/staff/caregiver/cg_note_test/note',
    'POST',
    { body: 'Double archive test' },
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  const createRes = await postStaff({ request: createReq, env });
  const created = await createRes.json();
  const noteId = created.note.id;

  const archiveReq1 = mockRequest(
    `https://example.com/api/staff/note/${noteId}/archive`,
    'POST',
    {},
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  const archiveRes1 = await postStaff({ request: archiveReq1, env });
  assert.equal(archiveRes1.status, 200);

  // Second archive attempt
  const archiveReq2 = mockRequest(
    `https://example.com/api/staff/note/${noteId}/archive`,
    'POST',
    {},
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  const archiveRes2 = await postStaff({ request: archiveReq2, env });
  assert.equal(archiveRes2.status, 409);
  const archiveData2 = await archiveRes2.json();
  assert.equal(archiveData2.ok, false);
  assert.equal(archiveData2.error, 'note is already archived');
});

test('8. POST /api/staff/note/:id/archive returns 404 for unknown note', async () => {
  const req = mockRequest(
    'https://example.com/api/staff/note/999999/archive',
    'POST',
    {},
    { 'x-dev-actor': 'staff@legacy-hub.org' }
  );
  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'note not found');
});

test('9. Hostile note body renders as text and never as raw executable markup', () => {
  const match = STAFF_JS.match(/function\s+escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'escapeHtml must be defined in staff.js');
  const escapeHtml = new Function(`${match[0]}; return escapeHtml;`)();

  const hostileBody = '<script>alert("xss")</script><img src="x" onerror="alert(1)">';
  const escaped = escapeHtml(hostileBody);

  assert.ok(!escaped.includes('<script>'), 'Must not contain unescaped script tag');
  assert.ok(!escaped.includes('<img'), 'Must not contain unescaped img tag');
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&lt;img'));
});

test('10. UI wiring: staff.js contains Add Note form, Archive button, and zero inline style attributes', () => {
  assert.match(STAFF_JS, /data-action="submit-add-note"/);
  assert.match(STAFF_JS, /data-action="archive-note"/);
  assert.match(STAFF_JS, /data-note-id=/);
  assert.match(STAFF_JS, /name="body"/);

  // Verify styles.css defines new classes
  assert.match(STYLES_CSS, /\.note-section-summary/);
  assert.match(STYLES_CSS, /\.record-form-panel/);
  assert.match(STYLES_CSS, /\.form-label-small/);
  assert.match(STYLES_CSS, /\.form-textarea-full/);
  assert.match(STYLES_CSS, /\.form-error-banner/);
  assert.match(STYLES_CSS, /\.note-row/);
  assert.match(STYLES_CSS, /\.note-content/);
  assert.match(STYLES_CSS, /\.note-list/);

  // Verify newly added Add Note form template has zero inline style="" attributes
  const addNoteMatch = STAFF_JS.match(/<form data-action="submit-add-note"[\s\S]*?<\/form>/);
  assert.ok(addNoteMatch, 'Add note form must be present in staff.js');
  assert.ok(!addNoteMatch[0].includes('style="'), 'Add note form must not contain inline style attributes');

  // Verify newly added note-row template has zero inline style="" attributes
  const noteRowMatch = STAFF_JS.match(/<div class="note-row"[\s\S]*?<\/div>/);
  assert.ok(noteRowMatch, 'note-row template must be present in staff.js');
  assert.ok(!noteRowMatch[0].includes('style="'), 'note-row must not contain inline style attributes');
});

function seedArchiveNote() {
  const inserted = raw.prepare(`
    INSERT INTO note (caregiver_id, author, body, visibility, status, created_at)
    VALUES ('cg_note_test', 'author@example.org', 'Fictional archive regression note', 'staff', 'active', '2026-01-01 00:00:00')
  `).run();
  const noteId = Number(inserted.lastInsertRowid);
  return { noteId, before: raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId) };
}

test('note create rolls back on original audit insertion failure', async () => {
  seedArchiveNote();
  const notesBefore = raw.prepare('SELECT * FROM note ORDER BY id').all();
  const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  raw.exec(`CREATE TRIGGER fail_note_create_audit BEFORE INSERT ON audit_log
    WHEN NEW.action = 'caregiver.note_added'
    BEGIN SELECT RAISE(ABORT, 'fictional note create audit failure'); END;`);

  const request = mockRequest('https://example.com/api/staff/caregiver/cg_note_test/note', 'POST',
    { body: 'Fictional atomic creation regression' }, { 'x-dev-actor': 'creator@example.org' });
  const res = await postStaff({ request, env });
  assert.equal(res.status, 500);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  assert.deepEqual(raw.prepare('SELECT * FROM note ORDER BY id').all(), notesBefore);
});

test('note create mutation failure leaves all notes and audits unchanged', async () => {
  seedArchiveNote();
  const notesBefore = raw.prepare('SELECT * FROM note ORDER BY id').all();
  const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  raw.exec(`CREATE TRIGGER fail_note_create_insert BEFORE INSERT ON note
    BEGIN SELECT RAISE(ABORT, 'fictional note create mutation failure'); END;`);
  const request = mockRequest('https://example.com/api/staff/caregiver/cg_note_test/note', 'POST',
    { body: 'Fictional mutation regression' }, { 'x-dev-actor': 'creator@example.org' });
  const res = await postStaff({ request, env });
  assert.equal(res.status, 500);
  assert.deepEqual(raw.prepare('SELECT * FROM note ORDER BY id').all(), notesBefore);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
});

test('note create uses the current generated ID after a rolled-back creation', async () => {
  seedArchiveNote();
  raw.exec(`CREATE TRIGGER fail_note_create_once BEFORE INSERT ON audit_log
    WHEN NEW.action = 'caregiver.note_added'
    BEGIN SELECT RAISE(ABORT, 'fictional rolled-back creation'); END;`);
  const request = () => mockRequest('https://example.com/api/staff/caregiver/cg_note_test/note', 'POST',
    { body: 'Fictional creation after rejected transaction' }, { 'x-dev-actor': 'creator@example.org' });
  assert.equal((await postStaff({ request: request(), env })).status, 500);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM note').get().n, 1);
  raw.exec('DROP TRIGGER fail_note_create_once');
  const res = await postStaff({ request: request(), env });
  assert.equal(res.status, 201);
  const data = await res.json();
  const audit = raw.prepare("SELECT * FROM audit_log WHERE action = 'caregiver.note_added'").get();
  assert.equal(data.note.id, 2);
  assert.equal(JSON.parse(audit.after_json).note_id, data.note.id);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM note').get().n, 2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 1);
});

test('note create correlates generated IDs across distinct note and audit sequences', async () => {
  seedArchiveNote();
  raw.prepare(`INSERT INTO audit_log (id, actor, action, entity, entity_id, after_json)
    VALUES (700, 'fixture@example.org', 'fixture.existing', 'fixture', 'unrelated', '{}')`).run();
  const notesBefore = raw.prepare('SELECT * FROM note ORDER BY id').all();
  const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  const ids = [];
  // JSON-looking text, quotes, backslashes, Unicode and embedded controls stay strings.
  for (const body of ['  Fictional "quoted" \\ note 🦋\nnext\tline\u0000end  ', '{"nested":true}']) {
    const actor = 'creator@example.org';
    const request = mockRequest('https://example.com/api/staff/caregiver/cg_note_test/note', 'POST',
      { body }, { 'x-dev-actor': actor });
    const res = await postStaff({ request, env });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.ok, true);
    const row = raw.prepare('SELECT * FROM note WHERE id = ?').get(data.note.id);
    assert.deepEqual(data.note, { ...row });
    assert.equal(row.caregiver_id, 'cg_note_test');
    assert.equal(row.author, actor);
    assert.equal(row.body, body.trim());
    assert.equal(row.visibility, 'staff');
    assert.equal(row.status, 'active');
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const audit = raw.prepare("SELECT * FROM audit_log WHERE action = 'caregiver.note_added' ORDER BY id DESC LIMIT 1").get();
    assert.notEqual(audit.id, row.id);
    assert.equal(audit.actor, actor);
    assert.equal(audit.entity, 'caregiver');
    assert.equal(audit.entity_id, row.caregiver_id);
    assert.equal(audit.before_json, null);
    assert.deepEqual(JSON.parse(audit.after_json), { note_id: row.id, author: actor, body: body.trim() });
    ids.push(row.id);
  }
  assert.deepEqual(ids, [2, 3]);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM note').get().n, notesBefore.length + 2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, auditsBefore.length + 2);
  assert.deepEqual(raw.prepare('SELECT * FROM note WHERE id = 1').get(), notesBefore[0]);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log WHERE id = 700').get(), auditsBefore[0]);
});

for (const scenario of [
  { name: 'unknown caregiver', caregiver: 'missing', body: { body: 'Fictional note' }, status: 404 },
  { name: 'forbidden actor field', body: { body: 'Fictional note', author: 'spoofed' }, status: 400 },
  { name: 'empty body', body: { body: '  ' }, status: 400 },
  { name: 'over-length body', body: { body: 'a'.repeat(2001) }, status: 400 },
  { name: 'non-object body', body: [], status: 400 },
  { name: 'invalid JSON', body: null, status: 400 }
]) {
  test(`note create preserves refusal without writes: ${scenario.name}`, async () => {
    seedArchiveNote();
    const notesBefore = raw.prepare('SELECT * FROM note ORDER BY id').all();
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    const request = mockRequest(`https://example.com/api/staff/caregiver/${scenario.caregiver || 'cg_note_test'}/note`,
      'POST', scenario.body, { 'x-dev-actor': 'creator@example.org' });
    const res = await postStaff({ request, env });
    assert.equal(res.status, scenario.status);
    assert.deepEqual(raw.prepare('SELECT * FROM note ORDER BY id').all(), notesBefore);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  });
}

function archiveRequest(noteId) {
  // Existing development-mode actor seam only; not Access middleware verification.
  return mockRequest(`https://example.com/api/staff/note/${noteId}/archive`, 'POST', {}, {
    'x-dev-actor': 'archiver@example.org'
  });
}

test('note archive rolls back on original audit insertion failure', async () => {
  const { noteId, before } = seedArchiveNote();
  const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  raw.exec(`CREATE TRIGGER fail_note_archive_audit BEFORE INSERT ON audit_log
    WHEN NEW.action = 'caregiver.note_archived'
    BEGIN SELECT RAISE(ABORT, 'fictional note archive audit failure'); END;`);

  const res = await postStaff({ request: archiveRequest(noteId), env });
  assert.equal(res.status, 500);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  assert.deepEqual(raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId), before);
});

test('note archive mutation failure leaves original row and audits unchanged', async () => {
  const { noteId, before } = seedArchiveNote();
  const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
  raw.exec(`CREATE TRIGGER fail_note_archive_update BEFORE UPDATE OF status ON note
    BEGIN SELECT RAISE(ABORT, 'fictional note archive mutation failure'); END;`);

  const res = await postStaff({ request: archiveRequest(noteId), env });
  assert.equal(res.status, 500);
  assert.deepEqual(raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId), before);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
});

test('note archive commits only status and original caregiver audit with actor', async () => {
  const { noteId, before } = seedArchiveNote();
  const res = await postStaff({ request: archiveRequest(noteId), env });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const after = raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId);
  assert.equal(after.status, 'archived');
  assert.deepEqual({ ...after, status: before.status }, { ...before });
  const audits = raw.prepare("SELECT * FROM audit_log WHERE action = 'caregiver.note_archived'").all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, 'archiver@example.org');
  assert.equal(audits[0].entity, 'caregiver');
  assert.equal(audits[0].entity_id, before.caregiver_id);
  assert.deepEqual(JSON.parse(audits[0].before_json), { note_id: noteId, status: 'active' });
  assert.deepEqual(JSON.parse(audits[0].after_json), { note_id: noteId, status: 'archived' });
});

for (const scenario of [
  { name: 'invalid ID', id: 'not-an-id', response: 400 },
  { name: 'missing ID', url: 'https://example.com/api/staff/note/archive', response: 400 },
  { name: 'unknown ID', id: '999999', response: 404 },
  { name: 'already archived', initial: 'archived', response: 409 }
]) {
  test(`note archive preserves refusal: ${scenario.name}`, async () => {
    const { noteId } = seedArchiveNote();
    if (scenario.initial) raw.prepare('UPDATE note SET status = ? WHERE id = ?').run(scenario.initial, noteId);
    const before = raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId);
    const auditsBefore = raw.prepare('SELECT * FROM audit_log ORDER BY id').all();
    const request = scenario.url ? mockRequest(scenario.url, 'POST', {}) : archiveRequest(scenario.id || noteId);
    const res = await postStaff({ request, env });
    assert.equal(res.status, scenario.response);
    assert.deepEqual(raw.prepare('SELECT * FROM note WHERE id = ?').get(noteId), before);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log ORDER BY id').all(), auditsBefore);
  });
}
