import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { onRequestPost as upload, onRequestGet as preview } from '../functions/api/staff/event-photo/[id].js';
import { onRequestGet as publicPhoto } from '../functions/media/r2/[[key]].js';
import { onRequestGet as publicEvents } from '../functions/api/events.js';
import { onRequestGet as staffGet } from '../functions/api/staff/[[path]].js';
import { setVerifiedAccessStaffActor } from '../functions/_lib/agent-confirmation.mjs';
import { inspectPhoto, photoForm, MAX_PHOTO_BYTES } from '../functions/_lib/event-photos.js';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3WQAAAAASUVORK5CYII=', 'base64'));
const actor = 'photos@example.org';
function fixture() {
  const raw = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0011_staff_member.sql', '0017_event_details.sql', '0018_event_photos.sql']) {
    raw.exec(readFileSync(new URL('../schema/' + file, import.meta.url), 'utf8'));
  }
  raw.prepare("INSERT INTO staff_member(email, role) VALUES(?, 'staff')").run(actor);
  raw.exec("INSERT INTO event(id,title,type,starts_at) VALUES('ev_photo_fixture','Fixture only','other','2040-01-01 10:00')");
  const objects = new Map(), puts = [], deletes = [];
  let beforeBatch, loseCommitReply = false, denyReadback = false;
  const db = {
    prepare(sql) {
      let params = [];
      return {
        bind(...args) { params = args; return this; },
        first() { if (denyReadback) throw new Error('unavailable'); return raw.prepare(sql).get(...params) || null; },
        all() { return { results: raw.prepare(sql).all(...params) }; },
        run() { const result = raw.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
      raw.exec('BEGIN');
      let results;
      try { results = statements.map(statement => statement.run()); raw.exec('COMMIT'); }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
      if (loseCommitReply) { loseCommitReply = false; throw new Error('reply lost after commit'); }
      return results;
    },
  };
  const env = { LEGACY_DB: db, MEDIA: {
    async put(key, bytes, options) {
      puts.push(key); objects.set(key, { body: bytes.slice(), size: bytes.length, ...options, httpEtag: '"fixture"' });
      return { key };
    },
    async get(key) { return objects.get(key) || null; },
    async delete(key) { deletes.push(key); objects.delete(key); },
  } };
  function context(request, identity = actor) {
    const data = {};
    if (identity) setVerifiedAccessStaffActor(data, identity);
    return { env, params: { id: 'ev_photo_fixture' }, request, data };
  }
  function request({ id = crypto.randomUUID(), expected = '', bytes = png, type = 'image/png', alt = 'Fixture photo', remove = false, origin = 'https://fixture.example' } = {}) {
    const form = new FormData();
    form.set('request_id', id); form.set('expected_photo_key', expected);
    if (remove) form.set('remove', '1');
    else { form.set('photo', new Blob([bytes], { type }), 'fixture.png'); form.set('alt', alt); }
    return new Request('https://fixture.example/api/staff/event-photo/ev_photo_fixture', { method: 'POST', headers: { origin }, body: form });
  }
  const current = () => raw.prepare("SELECT * FROM event WHERE id='ev_photo_fixture'").get();
  const audits = () => raw.prepare("SELECT * FROM audit_log WHERE action='event.photo.updated' ORDER BY id").all();
  const getPublic = key => publicPhoto({ request: new Request('https://fixture.example/media/r2/' + key), env, params: { key } });
  return { raw, env, context, request, current, audits, getPublic, objects, puts, deletes,
    before: callback => { beforeBatch = callback; }, loseReply: () => { loseCommitReply = true; },
    denyReads: () => { denyReadback = true; } };
}
async function save(f, options) {
  const response = await upload(f.context(f.request(options)));
  return { status: response.status, body: await response.json() };
}

test('upload persists bytes, photo reference and ORIGINAL audit; draft preview is staff-only', async () => {
  const f = fixture(); try {
    const result = await save(f);
    assert.equal(result.status, 200);
    assert.match(result.body.photo_key, /^event-photos\/.+\.png$/);
    assert.equal(f.current().photo_key, result.body.photo_key);
    assert.deepEqual(f.objects.get(result.body.photo_key).body, png);
    assert.equal(f.audits().length, 1);
    const original = f.audits()[0];
    assert.equal(original.id, result.body.audit_id);
    assert.equal(original.actor, actor);
    assert.equal(JSON.parse(original.before_json).photo_key, null);
    assert.equal(JSON.parse(original.after_json).photo_key, result.body.photo_key);
    assert.match(JSON.parse(original.after_json).content_sha256, /^[a-f0-9]{64}$/);
    assert.equal((await f.getPublic(result.body.photo_key)).status, 404);
    const privateResponse = await preview(f.context(new Request('https://fixture.example/api/staff/event-photo/ev_photo_fixture')));
    assert.equal(privateResponse.status, 200);
    assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual(new Uint8Array(await privateResponse.arrayBuffer()), png);
    assert.equal((await preview(f.context(new Request('https://fixture.example/api/staff/event-photo/ev_photo_fixture'), null))).status, 403);
    const staff = await staffGet({ env: f.env, request: new Request('https://fixture.example/api/staff/events') });
    assert.equal((await staff.json()).events[0].photo_key, result.body.photo_key);
    const changes = await staffGet({ env: f.env, request: new Request('https://fixture.example/api/staff/recent-changes') });
    const photoAudit = (await changes.json()).changes.find(change => change.id === original.id);
    assert.ok(photoAudit); assert.equal(photoAudit.can_undo, false);
  } finally { f.raw.close(); }
});

test('publication, replacement, unpublication and removal gate public bytes without deleting recovery objects', async () => {
  const f = fixture(); try {
    const first = (await save(f)).body.photo_key;
    f.raw.exec("UPDATE event SET publish_state='published'");
    const visible = await f.getPublic(first);
    assert.equal(visible.status, 200); assert.equal(visible.headers.get('content-type'), 'image/png');
    assert.equal(visible.headers.get('cache-control'), 'no-store');
    assert.equal(visible.headers.get('x-content-type-options'), 'nosniff');
    const list = await publicEvents({ env: f.env });
    assert.equal((await list.json()).events[0].photo_key, first);
    const replacement = await save(f, { expected: first, alt: 'Replacement' });
    assert.equal(replacement.status, 200); const second = replacement.body.photo_key;
    assert.notEqual(second, first); assert.equal((await f.getPublic(first)).status, 404);
    assert.equal((await f.getPublic(second)).status, 200);
    f.raw.exec("UPDATE event SET publish_state='draft'");
    assert.equal((await f.getPublic(second)).status, 404);
    f.raw.exec("UPDATE event SET publish_state='published'");
    assert.equal((await save(f, { expected: second, remove: true })).status, 200);
    assert.equal(f.current().photo_key, null); assert.equal(f.current().photo_alt, null);
    assert.equal((await f.getPublic(second)).status, 404);
    assert.ok(f.objects.has(first)); assert.ok(f.objects.has(second));
    assert.equal(f.audits().length, 3); assert.equal(f.deletes.length, 0);
  } finally { f.raw.close(); }
});

test('identical retry reads the same original audit; conflicting retry and stale editor cannot overwrite', async () => {
  const f = fixture(); try {
    const id = crypto.randomUUID(); const first = await save(f, { id });
    const repeated = await save(f, { id });
    assert.equal(repeated.status, 200); assert.equal(repeated.body.audit_id, first.body.audit_id);
    assert.equal(repeated.body.duplicate, true); assert.equal(f.puts.length, 1);
    assert.equal((await save(f, { id, alt: 'Different intent' })).status, 409);
    assert.equal((await save(f, { expected: '' })).status, 409);
    await save(f, { expected: first.body.photo_key, remove: true });
    const afterRemoval = await save(f, { id });
    assert.equal(afterRemoval.status, 409); assert.equal(afterRemoval.body.saved, true);
    assert.equal(f.current().photo_key, null); assert.equal(f.audits().length, 2);
  } finally { f.raw.close(); }
});

test('concurrent identical requests have one original effect and clean only the losing candidate', async () => {
  const f = fixture(); try {
    const id = crypto.randomUUID();
    const results = await Promise.all([save(f, { id }), save(f, { id })]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.equal(results[0].body.audit_id, results[1].body.audit_id);
    assert.equal(f.audits().length, 1); assert.equal(f.objects.size, 1);
    assert.equal(f.objects.has(f.current().photo_key), true);
  } finally { f.raw.close(); }
});

test('atomic audit failure rolls back association and removes only its unused new object', async () => {
  const f = fixture(); try {
    f.raw.exec("CREATE TRIGGER reject_photo_audit BEFORE INSERT ON audit_log WHEN NEW.action='event.photo.updated' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END");
    assert.equal((await save(f)).status, 503);
    assert.equal(f.current().photo_key, null); assert.equal(f.audits().length, 0);
    assert.equal(f.objects.size, 0); assert.equal(f.deletes.length, 1);
  } finally { f.raw.close(); }
});

test('lost transaction reply resolves from the original committed audit, without replay or object deletion', async () => {
  const f = fixture(); try {
    f.loseReply(); const result = await save(f);
    assert.equal(result.status, 200); assert.equal(result.body.duplicate, true);
    assert.equal(f.audits().length, 1); assert.equal(f.puts.length, 1); assert.equal(f.deletes.length, 0);
  } finally { f.raw.close(); }
});

test('unavailable authoritative readback retains the candidate and reports uncertainty', async () => {
  const f = fixture(); try {
    f.before(() => { f.denyReads(); throw new Error('write transport unavailable'); });
    const result = await save(f);
    assert.equal(result.status, 503); assert.equal(result.body.uncertain, true);
    assert.equal(f.deletes.length, 0); assert.equal(f.objects.size, 1);
    assert.equal(f.current().photo_key, null); assert.equal(f.audits().length, 0);
  } finally { f.raw.close(); }
});

test('published lookup still refuses another event metadata or wrong MIME; staff revocation blocks private preview', async () => {
  const f = fixture(); try {
    const key = (await save(f)).body.photo_key;
    f.raw.exec("UPDATE event SET publish_state='published'");
    const object = f.objects.get(key);
    object.customMetadata.event_id = 'ev_other';
    assert.equal((await f.getPublic(key)).status, 404);
    object.customMetadata.event_id = 'ev_photo_fixture'; object.httpMetadata.contentType = 'image/svg+xml';
    assert.equal((await f.getPublic(key)).status, 404);
    f.raw.exec("UPDATE staff_member SET status='deactivated'");
    assert.equal((await preview(f.context(new Request('https://fixture.example/api/staff/event-photo/ev_photo_fixture')))).status, 403);
  } finally { f.raw.close(); }
});

test('revocation, archival and a concurrent photo change are rechecked inside the atomic write', async () => {
  for (const mutation of ["UPDATE staff_member SET status='deactivated'", "UPDATE event SET publish_state='archived'", "UPDATE event SET photo_key='event-photos/00000000-0000-4000-8000-000000000000.png'"]) {
    const f = fixture(); try {
      f.before(() => f.raw.exec(mutation));
      assert.equal((await save(f)).status, 409);
      assert.equal(f.audits().length, 0); assert.equal(f.objects.size, 0);
    } finally { f.raw.close(); }
  }
});

test('unverified context, client actor header, wrong origin and deactivated staff cannot upload', async () => {
  const f = fixture(); try {
    const request = f.request(); request.headers.set('x-dev-actor', actor);
    assert.equal((await upload({ ...f.context(request, null), data: { actor, email: actor } })).status, 403);
    assert.equal((await save(f, { origin: 'https://other.example' })).status, 403);
    f.raw.exec("UPDATE staff_member SET status='deactivated'");
    assert.equal((await save(f)).status, 403);
    assert.equal(f.puts.length, 0); assert.equal(f.audits().length, 0);
  } finally { f.raw.close(); }
});

test('MIME mismatch, SVG, truncated image, oversized dimensions and file size are refused before storage', async () => {
  const tooWide = png.slice(); new DataView(tooWide.buffer).setUint32(16, 10001);
  for (const options of [{ type: 'image/jpeg' }, { bytes: new TextEncoder().encode('<svg/>'), type: 'image/svg+xml' },
    { bytes: png.slice(0, 33) }, { bytes: tooWide }, { bytes: new Uint8Array(MAX_PHOTO_BYTES + 1) }]) {
    const f = fixture(); try {
      const result = await save(f, options); assert.ok([400, 413].includes(result.status));
      assert.equal(f.puts.length, 0); assert.equal(f.audits().length, 0);
    } finally { f.raw.close(); }
  }
});

test('actual streamed size limit is enforced even without a Content-Length', async () => {
  const request = new Request('https://fixture.example', { method: 'POST', duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES + 32769)); controller.close(); } }) });
  await assert.rejects(photoForm(request), error => error.status === 413);
});

test('JPEG and both WebP frame forms derive dimensions from raster headers; metadata-only WebP is refused', () => {
  const jpeg = new Uint8Array([255,216,255,192,0,11,8,0,2,0,3,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
  assert.deepEqual(inspectPhoto(jpeg, 'image/jpeg'), { type: 'image/jpeg', extension: 'jpg', width: 3, height: 2 });
  function webp(chunk, payload) {
    const bytes = new Uint8Array(20 + payload.length + (payload.length & 1));
    bytes.set(new TextEncoder().encode('RIFF'), 0); new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    bytes.set(new TextEncoder().encode('WEBP' + chunk), 8); new DataView(bytes.buffer).setUint32(16, payload.length, true);
    bytes.set(payload, 20); return bytes;
  }
  assert.equal(inspectPhoto(webp('VP8 ', new Uint8Array([0,0,0,157,1,42,3,0,2,0])), 'image/webp').width, 3);
  assert.equal(inspectPhoto(webp('VP8L', new Uint8Array([47,0,0,0,0])), 'image/webp').height, 1);
  assert.throws(() => inspectPhoto(webp('VP8X', new Uint8Array(10)), 'image/webp'));
});

test('staff photo UI suppresses double submission and locks an uncertain result until page readback', async () => {
  const source = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
  const buttons = [{ disabled: false }, { disabled: false }], message = {}, calls = [];
  const fields = { '[data-photo-message]': message, '[name="photo"]': { files: [new Blob([png], { type: 'image/png' })] }, '[name="alt"]': { value: 'Fixture' } };
  const form = { getAttribute: key => key === 'data-event-id' ? 'ev_photo_fixture' : '', querySelector: key => fields[key], querySelectorAll: () => buttons };
  let reject;
  const context = vm.createContext({ FormData, crypto, Error, Set, Array, fetch: (...args) => { calls.push(args); return new Promise((_, fail) => { reject = fail; }); } });
  vm.runInContext(source.slice(source.indexOf('const eventPhotoPending ='), source.indexOf('function openEditEvent(')), context);
  const first = context.submitEventPhoto(form);
  await context.submitEventPhoto(form); assert.equal(calls.length, 1); assert.equal(buttons.every(button => button.disabled), true);
  reject(new Error('connection lost')); await first;
  assert.match(message.textContent, /Reload the page/);
  await context.submitEventPhoto(form); assert.equal(calls.length, 1); assert.equal(buttons.every(button => button.disabled), true);
});
