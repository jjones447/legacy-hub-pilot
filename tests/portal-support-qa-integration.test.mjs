// Exact integrated portal handler, fictional SQLite records and recording mail only.
// No runtime, provider, browser, configured identity or remote database. pc1-codex-5.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { onRequestGet as get, onRequestPost as post, onRequestHead as head } from '../functions/api/portal/[[path]].js';
import { prepareConfirmation } from './helpers/confirmed-portal.mjs';
import { canSendEmail } from '../functions/_lib/email.js';

const ORIGIN = 'https://fixture.example.invalid';
const QA = 'fixture-qa', OTHER = 'fixture-other', EMAIL = 'qa@example.invalid';
const SECRET = 'fictional-integration-secret';
const ID = '00112233-4455-4677-8899-aabbccddeeff';
const PAYLOAD = { request_id: ID, support_type: 'respite_services', urgency: 'general_inquiry',
  contact_preference: 'email', detail: 'Fictional support request' };
const PREVIEW = { ENVIRONMENT: 'preview', PORTAL_PREVIEW_MAIL_ENABLED: '1',
  PORTAL_PREVIEW_QA_CAREGIVER_ID: QA, PORTAL_PREVIEW_QA_EMAIL: EMAIL };
let raw, db, statements, writes, batches, mail;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_init', '0003_grant_award', '0005_portal_login']) {
    raw.exec(readFileSync(new URL(`../schema/${name}.sql`, import.meta.url), 'utf8'));
  }
  const insert = raw.prepare('INSERT INTO caregiver(id,first_name,email,phone) VALUES (?,?,?,?)');
  insert.run(QA, 'Fictional QA', EMAIL, '555-0101');
  insert.run(OTHER, 'Fictional Other', 'other@example.invalid', '555-0102');
  statements = []; writes = 0; batches = 0; mail = [];
  db = { prepare(sql) {
    statements.push(sql);
    const bound = params => ({ sql, params,
      async first() { return raw.prepare(sql).get(...params) ?? null; },
      async all() { return { success: true, results: raw.prepare(sql).all(...params) }; },
      async run() { writes++; const result = raw.prepare(sql).run(...params);
        return { success: true, meta: { changes: result.changes } }; },
    });
    return { ...bound([]), bind: (...params) => bound(params) };
  }, async batch(items) {
    batches++;
    raw.exec('BEGIN IMMEDIATE');
    try {
      const results = items.map(item => {
        const results = raw.prepare(item.sql).all(...item.params);
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(item.sql)) writes++;
        return { success: true, results, meta: { changes: raw.prepare('SELECT changes() n').get().n } };
      });
      raw.exec('COMMIT'); return results;
    } catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
  globalThis.fetch = async (url, init) => {
    mail.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 202 };
  };
});
afterEach(() => { raw.close(); globalThis.fetch = originalFetch; });
const settings = patch => ({ LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET, ...patch });
const preview = () => settings(PREVIEW);
function cookie(id, mode = 'preview', expiry = Date.now() + 60_000) {
  const payload = `${id}:${expiry}`;
  const prefix = mode === 'preview' ? `preview-qa:${QA}:${EMAIL}:` : '';
  const signature = createHmac('sha256', SECRET).update(`${prefix}session:${payload}`).digest('hex');
  return `portal_session=${encodeURIComponent(`${payload}:${signature}`)}`;
}
function request(method, signedCookie, { body = PAYLOAD, origin = ORIGIN, query = '', headers = {} } = {}) {
  return new Request(`${ORIGIN}/api/portal/support${query}`, { method,
    headers: { Origin: origin, Cookie: signedCookie, 'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
const submit = (env, signedCookie, options) => post({ env, request: request('POST', signedCookie, options) });
const history = (env, signedCookie, options) => get({ env, request: request('GET', signedCookie, options) });
function snapshot() {
  return ['followup', 'audit_log', 'note', 'portal_token'].map(table =>
    raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
}
async function assertDenied(env, signedCookie) {
  statements.length = 0;
  const counts = snapshot(), writeCount = writes, batchCount = batches, mailCount = mail.length;
  for (const response of [await history(env, signedCookie), await submit(env, signedCookie)]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
  }
  assert.deepEqual(snapshot(), counts);
  assert.equal(writes, writeCount); assert.equal(batches, batchCount); assert.equal(mail.length, mailCount);
  assert.equal(statements.some(sql => /followup|audit_log|\bnote\b|first_name/.test(sql)), false,
    'deny before support history/profile fields, batch or audit operations');
}

for (const environment of ['production', undefined, 'preview']) {
  test(`${environment ?? 'default'}: valid context-signed sessions can save and read own support with idempotent retry`, async () => {
    const env = settings(environment === 'preview' ? PREVIEW : { ENVIRONMENT: environment });
    for (const id of environment === 'preview' ? [QA] : [QA, OTHER]) {
      const signed = cookie(id, environment === 'preview' ? 'preview' : 'production');
      const created = await submit(env, signed);
      assert.equal(created.status, 201);
      const receipt = await created.json();
      assert.equal(receipt.request.request_id, ID);
      assert.equal((await submit(env, signed)).status, 201);
      const read = await history(env, signed);
      assert.equal(read.status, 200);
      const body = await read.json();
      assert.deepEqual(body.requests, [receipt.request]);
      assert.equal(body.profile_contact.email, id === QA ? EMAIL : 'other@example.invalid');
      assert.equal(receipt.request.private_notes, undefined);
      assert.equal(receipt.request.assigned_to, undefined);
    }
    const rows = raw.prepare('SELECT caregiver_id FROM followup ORDER BY caregiver_id').all().map(row => row.caregiver_id);
    assert.deepEqual(rows, environment === 'preview' ? [QA] : [OTHER, QA]);
    assert.equal(mail.length, 0, 'support requests never send sign-in or other mail');
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='portal.support_requested'").get().n, rows.length);
  });
}

test('actual QA login/confirmation session works on integrated support without any additional mail', async () => {
  const env = { ...preview(), EMAIL_API_KEY: 'fictional-provider-key' };
  const login = await post({ env, request: new Request(`${ORIGIN}/api/portal/login`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL }) }) });
  assert.equal(login.status, 200); assert.equal(mail.length, 1);
  const link = mail[0].body.text.match(/https:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
  const form = await prepareConfirmation(link, env);
  const confirmed = await post({ env, request: form.request() });
  assert.equal(confirmed.status, 302);
  const signed = confirmed.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await submit(env, signed)).status, 201);
  assert.equal((await history(env, signed)).status, 200);
  assert.equal(mail.length, 1); assert.deepEqual(mail[0].body.to, [EMAIL]);
  assert.equal(canSendEmail(env), false, 'QA login permission cannot become general preview mail');
  assert.equal(canSendEmail(env, { purpose: 'confirmation', recipient: EMAIL }), false);
});

for (const [label, signed] of [
  ['foreign identity in correct QA namespace', () => cookie(OTHER)],
  ['retained plain QA session', () => cookie(QA, 'production')],
  ['retained plain foreign session', () => cookie(OTHER, 'production')],
  ['expired QA session', () => cookie(QA, 'preview', Date.now() - 1000)],
  ['unknown identity', () => cookie('missing-row')],
  ['duplicate cookies', () => `${cookie(QA)}; ${cookie(OTHER)}`],
  ['malformed encoded cookie', () => 'portal_session=%E0%A4%A'],
]) test(`preview support denies ${label} with zero writes/mail or history reads`, async () => {
  await assertDenied(preview(), signed());
});

for (const [label, sql] of [
  ['archived selected row', "UPDATE caregiver SET status='archived' WHERE id=?"],
  ['changed selected email', "UPDATE caregiver SET email='changed@example.invalid' WHERE id=?"],
  ['changed selected id', "UPDATE caregiver SET id='renamed-qa' WHERE id=?"],
]) test(`preview support denies ${label} on both routes before effects`, async () => {
  raw.prepare(sql).run(QA); await assertDenied(preview(), cookie(QA));
});

test('current row email is normalized and checked afresh on both support routes', async () => {
  raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('  QA@EXAMPLE.INVALID  ', QA);
  const env = preview(), signed = cookie(QA);
  assert.equal((await submit(env, signed)).status, 201);
  assert.equal((await history(env, signed)).status, 200);
  raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('changed@example.invalid', QA);
  await assertDenied(env, signed);
});

test('production rejects archived/missing sessions but does not restrict a valid member to the QA tuple', async () => {
  const env = settings({ ...PREVIEW, ENVIRONMENT: 'production' });
  assert.equal((await submit(env, cookie(OTHER, 'production'))).status, 201);
  raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(OTHER);
  const baseline = snapshot(), writeCount = writes, batchCount = batches;
  for (const id of [OTHER, 'missing-row']) {
    const signed = cookie(id, 'production');
    assert.equal((await history(env, signed)).status, 401);
    assert.equal((await submit(env, signed)).status, 404, 'preserve production profile-not-found response');
  }
  assert.deepEqual(snapshot(), baseline); assert.equal(writes, writeCount);
  assert.equal(batches, batchCount); assert.equal(mail.length, 0);
});

test('disabled/missing tuple preview support GET/HEAD/POST refuse before secret, DB, body or mail', async () => {
  for (const patch of [{ PORTAL_PREVIEW_MAIL_ENABLED: '0' }, { PORTAL_PREVIEW_QA_EMAIL: undefined },
    { PORTAL_PREVIEW_QA_CAREGIVER_ID: undefined },
    { PORTAL_PREVIEW_MAIL_ENABLED: undefined, PREVIEW_MAIL_ENABLED: '1' }]) {
    const env = { ...PREVIEW, ...patch,
      get LEGACY_DB() { assert.fail('disabled database access'); },
      get PORTAL_TOKEN_SECRET() { assert.fail('disabled secret access'); } };
    for (const [method, handler] of [['GET', get], ['HEAD', head], ['POST', post]]) {
      const response = await handler({ env, request: request(method, cookie(QA)) });
      assert.equal(response.status, 503); assert.equal(response.headers.get('Set-Cookie'), null);
    }
  }
  assert.equal(writes, 0); assert.equal(batches, 0); assert.equal(mail.length, 0);
});

test('integrated support preserves owner, origin, body, duplicate-cookie and private-history boundaries', async () => {
  const env = settings({ ENVIRONMENT: 'production' }), qa = cookie(QA, 'production'), other = cookie(OTHER, 'production');
  assert.equal((await submit(env, qa)).status, 201);
  const baseline = snapshot(), writeCount = writes;
  assert.equal((await submit(env, qa, { origin: 'https://other.example.invalid' })).status, 403);
  assert.equal((await submit(env, qa, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await submit(env, qa, { body: { ...PAYLOAD, caregiver_id: OTHER } })).status, 400);
  assert.equal((await submit(env, `${qa}; ${qa}`)).status, 401);
  assert.equal((await history(env, other, { query: `?request_id=${ID}` })).status, 404);
  const own = await history(env, qa, { query: `?caregiver_id=${OTHER}` });
  assert.equal((await own.json()).requests.length, 1, 'query cannot select another caregiver');
  assert.deepEqual(snapshot(), baseline); assert.equal(writes, writeCount); assert.equal(mail.length, 0);
});
