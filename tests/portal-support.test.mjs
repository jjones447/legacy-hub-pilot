// Synthetic Node/SQLite contract tests, NOT D1/workerd or deployed acceptance.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { SUPPORT_DETAIL, SUPPORT_SOURCE, SUPPORT_BODY_MAX_BYTES } from '../functions/_lib/portal-support.js';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postIntake } from '../functions/api/intake.js';

const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const ORIGIN = 'https://portal.example.test';
const SECRET = 'synthetic-support-test-secret';
const ID = '00112233-4455-4677-8899-aabbccddeeff';
let raw;
let env;

// Mirrors documented D1 batch ordering/rollback with real in-memory SQLite SQL.
// This adapter is deliberately not evidence of actual Workers binding behavior.
function d1(options = {}) {
  return {
    prepare(sql) {
      return { bind(...params) { return {
        sql, params,
        async first() { return raw.prepare(sql).get(...params) ?? null; },
        async run() { return raw.prepare(sql).run(...params); },
      }; } };
    },
    async batch(statements) {
      if (options.beforeBatch) await options.beforeBatch();
      raw.exec('BEGIN IMMEDIATE');
      let results;
      try {
        results = statements.map((s, i) => {
          if (options.failIndex === i) throw new Error('synthetic SQL failure: private detail');
          const rows = raw.prepare(s.sql).all(...s.params);
          return { success: true, results: rows, meta: { changes: raw.prepare('SELECT changes() AS n').get().n } };
        });
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      if (options.afterCommit) await options.afterCommit();
      return results;
    },
  };
}

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(SCHEMA);
  raw.prepare('INSERT INTO caregiver (id, first_name) VALUES (?, ?)').run('cg_synthetic_a', 'Synthetic A');
  raw.prepare('INSERT INTO caregiver (id, first_name) VALUES (?, ?)').run('cg_synthetic_b', 'Synthetic B');
  env = { LEGACY_DB: d1(), PORTAL_TOKEN_SECRET: SECRET };
});
afterEach(() => raw.close());

async function cookieFor(owner = 'cg_synthetic_a', expiry = Date.now() + 60_000) {
  const payload = `${owner}:${expiry}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${payload}`)));
  const sig = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `portal_session=${encodeURIComponent(`${payload}:${sig}`)}`;
}

async function request(options = {}) {
  const headers = new Headers({ 'Origin': ORIGIN, 'Content-Type': 'application/json',
    'Sec-Fetch-Site': 'same-origin', 'Cookie': await cookieFor(options.owner, options.expiry) });
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === null) headers.delete(name); else headers.set(name, value);
  }
  const body = options.rawBody ?? JSON.stringify(options.body ?? { request_id: ID });
  return new Request(`${ORIGIN}${options.path || '/api/portal/support'}`, {
    method: 'POST', headers, body,
  });
}
async function submit(options = {}, useEnv = env) {
  return onRequestPost({ request: await request(options), env: useEnv });
}
function counts() {
  return {
    tasks: raw.prepare('SELECT COUNT(*) AS n FROM followup').get().n,
    audits: raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
    caregivers: raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get().n,
  };
}
function empty() { assert.deepEqual(counts(), { tasks: 0, audits: 0, caregivers: 2 }); }

test('fixed help creates one owner task and attributable audit, no contact/detail/id leakage', async () => {
  const res = await submit();
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
  const task = raw.prepare('SELECT * FROM followup').get();
  assert.equal(task.caregiver_id, 'cg_synthetic_a');
  assert.equal(task.kind, 'support_request');
  assert.equal(task.detail, SUPPORT_DETAIL);
  assert.equal(task.status, 'open');
  assert.equal(task.source, SUPPORT_SOURCE);
  assert.match(task.external_ref, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(task).includes(ID));
  const audit = raw.prepare('SELECT * FROM audit_log').get();
  assert.equal(audit.actor, task.caregiver_id);
  assert.equal(audit.action, 'portal.support_requested');
  assert.equal(audit.entity, 'followup');
  assert.equal(audit.entity_id, String(task.id));
  assert.equal(audit.before_json, null);
  assert.equal(audit.after_json, null);
});

test('same owner/id replay is idempotent; a second owner using the same id is distinct', async () => {
  assert.equal((await submit()).status, 202);
  assert.equal((await submit()).status, 202);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
  assert.equal((await submit({ owner: 'cg_synthetic_b' })).status, 202);
  const tasks = raw.prepare('SELECT caregiver_id, external_ref FROM followup ORDER BY id').all();
  assert.notEqual(tasks[0].external_ref, tasks[1].external_ref);
  assert.deepEqual(counts(), { tasks: 2, audits: 2, caregivers: 2 });
});

test('case variants of a UUID replay the same request', async () => {
  assert.equal((await submit()).status, 202);
  assert.equal((await submit({ body: { request_id: ID.toUpperCase() } })).status, 202);
  assert.equal(counts().tasks, 1);
  assert.equal(counts().audits, 1);
});

async function supportRef(owner = 'cg_synthetic_a') {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([owner, ID])));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

test('public intake cannot occupy the signed support namespace, and ordinary intake still works', async () => {
  raw.prepare('UPDATE caregiver SET email = ? WHERE id = ?').run('synthetic@example.test', 'cg_synthetic_a');
  const body = { kind: 'support_request', first_name: 'Synthetic A', email: 'synthetic@example.test',
    source: SUPPORT_SOURCE, external_ref: await supportRef(), message: 'Synthetic intake text' };
  const denied = await postIntake({ env, request: new Request(`${ORIGIN}/api/intake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  assert.equal(denied.status, 400);
  assert.equal(counts().tasks, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.support_requested'").get().n, 0);
  assert.equal((await submit()).status, 202);
  const ordinary = await postIntake({ env, request: new Request(`${ORIGIN}/api/intake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, source: 'site_form' }),
  }) });
  assert.equal(ordinary.status, 201);
  assert.equal(counts().tasks, 2);
  assert.equal(raw.prepare("SELECT detail FROM followup WHERE source = 'site_form'").get().detail, body.message);
});

test('reserved source is refused before any intake core database access', async () => {
  const res = await handleIntake({ prepare() { throw new Error('must not read or mutate'); } }, {
    kind: 'support_request', first_name: 'Synthetic', email: 'synthetic@example.test',
    external_ref: 'synthetic-key', source: SUPPORT_SOURCE,
  });
  assert.equal(res.status, 400);
  empty();
});

for (const [name, owner, kind, detail] of [
  ['same-owner arbitrary detail', 'cg_synthetic_a', 'support_request', 'Synthetic untrusted intake text'],
  ['same-owner exact detail without original portal audit', 'cg_synthetic_a', 'support_request', SUPPORT_DETAIL],
  ['another owner occupying this owner key', 'cg_synthetic_b', 'support_request', SUPPORT_DETAIL],
  ['same-owner incompatible kind', 'cg_synthetic_a', 'membership_welcome', SUPPORT_DETAIL],
]) {
  test(`legacy namespace pollution is refused without adoption or mutation: ${name}`, async () => {
    // Synthetic historical rows only; no repair/deletion of existing history.
    raw.prepare('INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, ?, ?, ?, ?)')
      .run(owner, kind, detail, SUPPORT_SOURCE, await supportRef());
    const before = raw.prepare('SELECT * FROM followup').all();
    for (let retry = 0; retry < 2; retry++) {
      assert.equal((await submit()).status, 404);
      assert.equal(counts().audits, 0);
      assert.deepEqual(raw.prepare('SELECT * FROM followup').all(), before);
    }
  });
}

test('a genuine audit does not bless later noncanonical detail and remains immutable', async () => {
  assert.equal((await submit()).status, 202);
  raw.prepare('UPDATE followup SET detail = ?').run('Synthetic changed detail');
  const before = raw.prepare('SELECT * FROM followup').all();
  const audit = raw.prepare('SELECT * FROM audit_log').all();
  assert.equal((await submit()).status, 404);
  assert.deepEqual(raw.prepare('SELECT * FROM followup').all(), before);
  assert.deepEqual(raw.prepare('SELECT * FROM audit_log').all(), audit);
});

test('a new request id creates a distinct intentional request', async () => {
  assert.equal((await submit()).status, 202);
  assert.equal((await submit({ body: { request_id: '11223344-5566-4788-99aa-bbccddeeff00' } })).status, 202);
  assert.equal(counts().tasks, 2);
  assert.equal(counts().audits, 2);
});

test('simultaneously admitted retries execute SQL transactions without duplicate task/audit', async () => {
  let arrived = 0;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  env.LEGACY_DB = d1({ async beforeBatch() { if (++arrived === 8) release(); await ready; } });
  const results = await Promise.all(Array.from({ length: 8 }, () => submit()));
  assert.ok(results.every(r => r.status === 202));
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
});

for (const [name, headers] of [
  ['missing cookie', { Cookie: null }],
  ['invalid signature', { Cookie: 'portal_session=cg_synthetic_a:9999999999999:invalid' }],
  ['malformed encoding', { Cookie: 'portal_session=%E0%A4%A' }],
  ['magic token as cookie', { Cookie: 'portal_session=opaque-magic-link-value' }],
  ['lookalike cookie name', { Cookie: 'evilportal_session=cg_synthetic_a:9999999999999:invalid' }],
  ['oversized cookie', { Cookie: 'x'.repeat(4097) }],
]) {
  test(`authentication refuses ${name} before mutation`, async () => {
    assert.equal((await submit({ headers })).status, 401);
    empty();
  });
}
test('two exact signed session cookies are refused rather than choosing an owner', async () => {
  const cookies = `${await cookieFor()}; ${await cookieFor('cg_synthetic_b')}`;
  assert.equal((await submit({ headers: { Cookie: cookies } })).status, 401);
  empty();
});
test('a valid lookalike name cannot authenticate, while another unrelated cookie does not block the exact name', async () => {
  const valid = await cookieFor();
  assert.equal((await submit({ headers: { Cookie: `evil${valid}` } })).status, 401);
  empty();
  assert.equal((await submit({ headers: { Cookie: `theme=dark; ${valid}; other=1` } })).status, 202);
});
test('expired and signed nonfinite sessions are refused', async () => {
  for (const expiry of [Date.now() - 1000, 'NaN', 'Infinity']) {
    assert.equal((await submit({ expiry })).status, 401);
    empty();
  }
});
test('missing auth configuration fails closed with no task', async () => {
  assert.equal((await submit({}, { ...env, PORTAL_TOKEN_SECRET: undefined })).status, 503);
  empty();
});
test('nonexistent signed owner never creates a caregiver or task', async () => {
  assert.equal((await submit({ owner: 'cg_synthetic_missing' })).status, 404);
  empty();
});
test('archived owner, including replay after archival, cannot submit', async () => {
  raw.prepare("UPDATE caregiver SET status = 'archived' WHERE id = ?").run('cg_synthetic_a');
  assert.equal((await submit()).status, 404);
  empty();
  raw.prepare("UPDATE caregiver SET status = 'active' WHERE id = ?").run('cg_synthetic_a');
  assert.equal((await submit()).status, 202);
  raw.prepare("UPDATE caregiver SET status = 'archived' WHERE id = ?").run('cg_synthetic_a');
  assert.equal((await submit()).status, 404);
  assert.equal(counts().tasks, 1);
  assert.equal(counts().audits, 1);
});
test('archival immediately before the transaction is rechecked, not a stale eligibility grant', async () => {
  env.LEGACY_DB = d1({ beforeBatch() { raw.prepare("UPDATE caregiver SET status = 'archived' WHERE id = ?").run('cg_synthetic_a'); } });
  assert.equal((await submit()).status, 404);
  empty();
});

for (const headers of [
  { Origin: null }, { Origin: 'null' }, { Origin: 'https://other.example.test' },
  { Origin: 'http://portal.example.test' }, { Origin: `${ORIGIN}/` },
  { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
]) {
  test(`CSRF refusal ${JSON.stringify(headers)} leaves no task or audit`, async () => {
    assert.equal((await submit({ headers })).status, 403);
    empty();
  });
}
test('same-origin JSON clients without optional fetch metadata are admitted', async () => {
  assert.equal((await submit({ headers: { 'Sec-Fetch-Site': null } })).status, 202);
});

for (const body of [
  {}, [], null, 'text', 5, { request_id: 123 }, { request_id: '' },
  { request_id: 'a'.repeat(65) }, { request_id: '../private' },
  { request_id: '00112233-4455-1677-8899-aabbccddeeff' },
  { request_id: ID, caregiver_id: 'cg_synthetic_b' },
  { request_id: ID, email: 'synthetic@example.test' },
  { request_id: ID, contact: 'synthetic' },
  { request_id: ID, detail: 'private synthetic text' },
  { request_id: ID, note: 'private synthetic text' },
  { request_id: ID, kind: 'other' },
]) {
  test(`body whitelist rejects ${JSON.stringify(body)} without data collection`, async () => {
    assert.equal((await submit({ rawBody: JSON.stringify(body) })).status, 400);
    empty();
  });
}
test('prototype-shaped extra properties and malformed JSON are refused', async () => {
  for (const rawBody of [`{"request_id":"${ID}","__proto__":{}}`, '{', '']) {
    assert.equal((await submit({ rawBody })).status, 400);
    empty();
  }
});
test('only JSON media type with optional UTF-8 charset is accepted', async () => {
  for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=latin1']) {
    assert.equal((await submit({ headers: { 'Content-Type': type } })).status, 415);
    empty();
  }
  assert.equal((await submit({ headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status, 202);
});
test('declared or actual oversized bodies and invalid lengths fail before SQL', async () => {
  for (const headers of [{ 'Content-Length': String(SUPPORT_BODY_MAX_BYTES + 1) }, { 'Content-Length': '-1' }, { 'Content-Length': 'bad' }]) {
    assert.equal((await submit({ headers })).status, 413);
    empty();
  }
  assert.equal((await submit({ rawBody: ' '.repeat(SUPPORT_BODY_MAX_BYTES + 1) })).status, 413);
  assert.equal((await submit({ rawBody: ' '.repeat(SUPPORT_BODY_MAX_BYTES + 1), headers: { 'Content-Length': '1' } })).status, 413);
  empty();
});
test('chunked overflow cancels reader and invalid UTF-8 is not silently repaired', async () => {
  let cancelled = false;
  let delivered = 0;
  const req = await request();
  const stream = new ReadableStream({
    pull(controller) { if (++delivered <= 3) controller.enqueue(new Uint8Array(100)); },
    cancel() { cancelled = true; },
  });
  const res = await onRequestPost({ env, request: { url: req.url, headers: req.headers, body: stream } });
  assert.equal(res.status, 413);
  assert.equal(cancelled, true);
  empty();
  const badUtf8 = new Uint8Array([0xff]);
  assert.equal((await submit({ rawBody: badUtf8 })).status, 400);
  empty();
});
test('stream failure and absent body leave no mutation', async () => {
  const req = await request();
  for (const body of [null, new ReadableStream({ start(c) { c.error(new Error('synthetic read failure')); } })]) {
    assert.equal((await onRequestPost({ env, request: { url: req.url, headers: req.headers, body } })).status, 400);
    empty();
  }
});

for (const failIndex of [0, 1, 2]) {
  test(`statement ${failIndex + 1} failure rolls back task and audit and preserves safe error`, async () => {
    env.LEGACY_DB = d1({ failIndex });
    const res = await submit();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: 'unavailable' });
    empty();
    env.LEGACY_DB = d1();
    assert.equal((await submit()).status, 202);
    assert.equal(counts().tasks, 1);
    assert.equal(counts().audits, 1);
  });
}
test('real SQLite audit constraint failure rolls back the task (not only a fake thrown error)', async () => {
  raw.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic audit refusal'); END");
  assert.equal((await submit()).status, 503);
  empty();
  raw.exec('DROP TRIGGER synthetic_audit_failure');
  assert.equal((await submit()).status, 202);
  assert.equal(counts().tasks, 1);
  assert.equal(counts().audits, 1);
});
test('missing batch capability cannot fall back to separate unsafe writes', async () => {
  for (const db of [null, { prepare() { throw new Error('must not execute'); } }]) {
    assert.equal((await submit({}, { ...env, LEGACY_DB: db })).status, 503);
    empty();
  }
});
test('lost acknowledgement after a committed batch retries same id without a duplicate or orphan', async () => {
  env.LEGACY_DB = d1({ afterCommit() { throw new Error('synthetic lost response'); } });
  assert.equal((await submit()).status, 503);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
  env.LEGACY_DB = d1();
  assert.equal((await submit()).status, 202);
  assert.deepEqual(counts(), { tasks: 1, audits: 1, caregivers: 2 });
});
test('invalid result acknowledgement is unavailable; committed effects stay idempotent on retry', async () => {
  const normal = d1();
  env.LEGACY_DB = { ...normal, async batch(s) { await normal.batch(s); return []; } };
  assert.equal((await submit()).status, 503);
  env.LEGACY_DB = normal;
  assert.equal((await submit()).status, 202);
  assert.equal(counts().tasks, 1);
  assert.equal(counts().audits, 1);
});
test('replay does not reopen done/dismissed tasks or rewrite append-only audit', async () => {
  assert.equal((await submit()).status, 202);
  const originalAudit = raw.prepare('SELECT * FROM audit_log').all();
  for (const status of ['done', 'dismissed']) {
    raw.prepare('UPDATE followup SET status = ?').run(status);
    assert.equal((await submit()).status, 202);
    assert.equal(raw.prepare('SELECT status FROM followup').get().status, status);
    assert.deepEqual(raw.prepare('SELECT * FROM audit_log').all(), originalAudit);
  }
  assert.throws(() => raw.exec("UPDATE audit_log SET actor = 'changed'"), /append-only/);
  assert.throws(() => raw.exec('DELETE FROM audit_log'), /append-only/);
});
test('support is POST-only, does not activate login/email/provider behavior or other portal paths', async () => {
  const req = await request();
  assert.equal((await onRequestGet({ request: req, env })).status, 404);
  for (const key of ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'PORTAL_DEV_RETURN_LINK']) {
    Object.defineProperty(env, key, { get() { throw new Error('provider configuration must not be read'); } });
  }
  assert.equal((await submit()).status, 202);
  const unknown = await submit({ path: '/api/portal/unknown' });
  assert.equal(unknown.status, 404);
  assert.equal(counts().tasks, 1);
});
