// Source-only qualification: synthetic requests, in-memory SQLite, recording mail fake.
// No service, mailbox, browser, configured identity or provider is accessed. pc1-codex-5.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
import { onRequestGet as get, onRequestPost as post, onRequestHead as head } from '../functions/api/portal/[[path]].js';
import { prepareConfirmation } from './helpers/confirmed-portal.mjs';
import { canSendEmail, sendEmail } from '../functions/_lib/email.js';
import { previewQACaregiver } from '../functions/_lib/portal-preview.mjs';

const ORIGIN = 'https://staging.example.invalid';
const QA = 'fixture-qa', EMAIL = 'qa@example.invalid', OTHER = 'fixture-other';
const SECRET = 'synthetic-not-a-deployed-secret';
const SETTINGS = { ENVIRONMENT: 'preview', PORTAL_PREVIEW_MAIL_ENABLED: '1',
  PORTAL_PREVIEW_QA_CAREGIVER_ID: QA, PORTAL_PREVIEW_QA_EMAIL: EMAIL,
  EMAIL_API_KEY: 'synthetic-not-a-provider-key', PORTAL_TOKEN_SECRET: SECRET };
const hash = value => createHash('sha256').update(value).digest('hex');
const prefix = env => `preview-qa:${env.PORTAL_PREVIEW_QA_CAREGIVER_ID.trim()}:${env.PORTAL_PREVIEW_QA_EMAIL.trim().toLowerCase()}:`;
const session = (id, context = '') => {
  const payload = `${id}:${Date.now() + 60_000}`;
  return `portal_session=${encodeURIComponent(`${payload}:${createHmac('sha256', SECRET).update(`${context}session:${payload}`).digest('hex')}`)}`;
};
const answers = { stress: 2, sleep: 4, support: 3, self_time: 4 };
const originalFetch = globalThis.fetch;
let raw, env, calls, queries, beforeRun, claimResponse;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  for (const name of ['0001_init', '0003_grant_award', '0005_portal_login', '0012_wellness_checkin']) {
    raw.exec(readFileSync(new URL(`../schema/${name}.sql`, import.meta.url), 'utf8'));
  }
  const insert = raw.prepare('INSERT INTO caregiver (id, first_name, last_name, email, source) VALUES (?, ?, ?, ?, ?)');
  insert.run(QA, 'Fictional', 'QA', EMAIL, 'synthetic');
  insert.run(OTHER, 'Fictional', 'Other', 'other@example.invalid', 'synthetic');
  calls = []; queries = []; beforeRun = null; claimResponse = undefined;
  const wrap = (sql, values) => ({
    async first() { return raw.prepare(sql).get(...values) ?? null; },
    async all() { return { results: raw.prepare(sql).all(...values) }; },
    async run() {
      if (beforeRun) beforeRun(sql, values);
      const result = raw.prepare(sql).run(...values);
      if (sql.startsWith('UPDATE portal_token') && claimResponse !== undefined) return claimResponse;
      return { success: true, meta: { changes: result.changes } };
    },
  });
  env = { ...SETTINGS, LEGACY_DB: { prepare(sql) {
    queries.push(sql);
    return { ...wrap(sql, []), bind: (...values) => wrap(sql, values) };
  } } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 202 };
  };
});
afterEach(() => { globalThis.fetch = originalFetch; raw.close(); });

function request(action, method = 'GET', body, cookie) {
  return new Request(`${ORIGIN}/api/portal/${action}`, { method,
    headers: { Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const login = (email = EMAIL, settings = env) => post({ env: settings, request: request('login', 'POST', { email }) });
function link() { return calls.at(-1).body.text.match(/https:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0]; }
async function redeem(url, settings = env) {
  const form = await prepareConfirmation(url, settings);
  assert.equal(form.landing.status, 200);
  return post({ env: settings, request: form.request() });
}
const count = table => raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const cookieOf = response => response.headers.get('Set-Cookie')?.split(';')[0];
function insertToken(token, id, context = '') {
  raw.prepare("INSERT INTO portal_token (token_hash,caregiver_id,expires_at,used) VALUES (?,?,datetime('now','+10 minutes'),0)")
    .run(hash(context ? `${context}token:${token}` : token), id);
}

test('single configured QA completes non-consuming landing, explicit single-use confirmation, own data/check-in and logout', async () => {
  assert.equal((await login('  QA@EXAMPLE.INVALID ')).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.to, [EMAIL]);
  assert.equal(count('portal_token'), 1);
  const form = await prepareConfirmation(link(), env);
  assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 0, 'GET never redeems');
  const h = await head({ env, request: new Request(link(), { method: 'HEAD' }) });
  assert.equal(h.status, 200); assert.equal(h.headers.get('Set-Cookie'), null);
  const signedIn = await post({ env, request: form.request() });
  assert.equal(signedIn.status, 302);
  const cookie = cookieOf(signedIn);
  assert.equal((await post({ env, request: form.request() })).status, 400, 'one winner only');
  const me = await get({ env, request: request('me?caregiver_id=' + OTHER, 'GET', null, cookie) });
  const profile = await me.json();
  assert.equal(me.status, 200); assert.equal(profile.profile.id, QA);
  assert.equal((await get({ env, request: request('wellness', 'GET', null, cookie) })).status, 200);
  assert.equal((await post({ env, request: request('wellness', 'POST', { answers, caregiver_id: OTHER }, cookie) })).status, 200);
  assert.deepEqual(raw.prepare('SELECT caregiver_id FROM wellness_checkin').all().map(r => r.caregiver_id), [QA]);
  const out = await post({ env, request: request('logout', 'POST', null, cookie) });
  assert.equal(out.status, 200); assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(calls.length, 1, 'wellness/logout send no mail');
});

test('missing/malformed configuration, legacy fallback and confirmation-only flags fail before secret, DB or body access', async () => {
  const variants = [
    { PORTAL_PREVIEW_MAIL_ENABLED: '' }, { PORTAL_PREVIEW_MAIL_ENABLED: 'false' },
    { PORTAL_PREVIEW_QA_CAREGIVER_ID: undefined }, { PORTAL_PREVIEW_QA_CAREGIVER_ID: 'one,two' },
    { PORTAL_PREVIEW_QA_CAREGIVER_ID: 'id:other' }, { PORTAL_PREVIEW_QA_EMAIL: undefined },
    { PORTAL_PREVIEW_QA_EMAIL: 'qa@example.invalid,other@example.invalid' },
    { PORTAL_PREVIEW_QA_EMAIL: 'not-an-address' }, { PORTAL_PREVIEW_QA_EMAIL: 'x'.repeat(255) + '@example.invalid' },
    { PORTAL_PREVIEW_MAIL_ENABLED: undefined, PREVIEW_MAIL_ENABLED: '1' },
    { PORTAL_PREVIEW_MAIL_ENABLED: undefined, CONFIRMATION_PREVIEW_MAIL_ENABLED: '1', CONFIRMATION_PREVIEW_RECIPIENTS: EMAIL },
    { ENVIRONMENT: 'development' },
  ];
  for (const variant of variants) {
    const settings = { ...SETTINGS, ...variant,
      get LEGACY_DB() { assert.fail('disabled DB access'); },
      get PORTAL_TOKEN_SECRET() { assert.fail('disabled secret access'); } };
    for (const action of ['login', 'verify', 'me', 'wellness']) {
      for (const method of ['GET', 'POST']) {
        const response = await (method === 'GET' ? get : post)({ env: settings,
          request: { url: `${ORIGIN}/api/portal/${action}`, json() { assert.fail('disabled body access'); } } });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { ok: false, error: 'preview_portal_disabled' });
        assert.equal(response.headers.get('Set-Cookie'), null);
      }
    }
    const out = await post({ env: settings, request: { url: `${ORIGIN}/api/portal/logout` } });
    assert.equal(out.status, 200); assert.match(out.headers.get('Set-Cookie'), /Max-Age=0/);
  }
  assert.equal(calls.length, 0);
});

test('known alternate and unknown addresses receive the same generic response without profile lookup, token or send', async () => {
  for (const email of ['other@example.invalid', 'unknown@example.invalid']) {
    queries.length = 0;
    const response = await login(email);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    assert.equal(queries.some(q => /FROM caregiver|portal_token/.test(q)), false);
  }
  assert.equal(count('portal_token'), 0); assert.equal(calls.length, 0);
});

test('configured email alone cannot select another row; id, current email and nonarchived status must all match', async () => {
  for (const change of [
    () => raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('changed@example.invalid', QA),
    () => { raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('changed@example.invalid', QA);
      raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run(EMAIL, OTHER); },
    () => raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(QA),
  ]) {
    raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('other@example.invalid', OTHER);
    raw.prepare("UPDATE caregiver SET email=?,status='active' WHERE id=?").run(EMAIL, QA);
    change();
    const response = await login();
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    assert.equal(count('portal_token'), 0); assert.equal(calls.length, 0);
  }
});

test('QA flag enables only explicit server-selected sign-in purpose for the exact id and recipient', async () => {
  assert.deepEqual(previewQACaregiver({ ...env, PORTAL_PREVIEW_QA_EMAIL: ' QA@EXAMPLE.INVALID ' }), { id: QA, email: EMAIL });
  const approved = { purpose: 'portal-signin', caregiverId: QA, recipient: EMAIL };
  assert.equal(canSendEmail(env, approved), true);
  for (const options of [{}, { purpose: 'confirmation', recipient: EMAIL }, { purpose: 'other', recipient: EMAIL },
    { ...approved, caregiverId: OTHER }, { ...approved, recipient: 'other@example.invalid' },
    { ...approved, recipient: `${EMAIL},other@example.invalid` }, { ...approved, caregiverId: undefined }]) {
    assert.equal(canSendEmail(env, options), false);
    const result = await sendEmail(env, { to: options.recipient ?? EMAIL, subject: 'synthetic',
      text: 'synthetic', purpose: options.purpose, caregiverId: options.caregiverId });
    assert.deepEqual(result, { ok: false, status: 0 });
  }
  assert.equal(calls.length, 0);
  const confirmation = { ...env, PORTAL_PREVIEW_MAIL_ENABLED: '0',
    CONFIRMATION_PREVIEW_MAIL_ENABLED: '1', CONFIRMATION_PREVIEW_RECIPIENTS: EMAIL };
  assert.equal(canSendEmail(confirmation, { purpose: 'confirmation', recipient: EMAIL }), true);
  assert.equal(canSendEmail(confirmation, approved), false, 'independent confirmation permission is not portal permission');
});

test('retained pre-fence tokens and sessions for QA and other identities cannot authenticate after opt-in', async () => {
  for (const id of [QA, OTHER]) {
    const token = `old_${id}`;
    insertToken(token, id);
    const response = await redeem(`${ORIGIN}/api/portal/verify?token=${token}`);
    assert.equal(response.status, 400); assert.equal(response.headers.get('Set-Cookie'), null);
    for (const action of ['me', 'wellness']) {
      queries.length = 0;
      assert.equal((await get({ env, request: request(action, 'GET', null, session(id)) })).status, 401);
      assert.equal(queries.length, 0, 'old signed format fails before all data reads');
    }
    assert.equal((await post({ env, request: request('wellness', 'POST', { answers }, session(id)) })).status, 401);
  }
  assert.deepEqual(raw.prepare('SELECT used FROM portal_token').all().map(r => r.used), [0, 0]);
  assert.equal(count('wellness_checkin'), 0); assert.equal(calls.length, 0);
});

test('even correctly context-signed alternate sessions and context-hashed alternate tokens are refused without consuming them', async () => {
  insertToken('alternate_token', OTHER, prefix(env));
  assert.equal((await redeem(`${ORIGIN}/api/portal/verify?token=alternate_token`)).status, 400);
  assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 0);
  queries.length = 0;
  assert.equal((await get({ env, request: request('me', 'GET', null, session(OTHER, prefix(env))) })).status, 401);
  assert.equal(queries.length, 0);
});

test('changed configuration invalidates pending confirmations, tokens and sessions; disabled flag blocks all existing credentials', async () => {
  await login();
  const pending = await prepareConfirmation(link(), env);
  const signedIn = await redeem(link());
  const cookie = cookieOf(signedIn);
  const changed = { ...env, PORTAL_PREVIEW_QA_EMAIL: 'changed@example.invalid' };
  assert.equal((await post({ env: changed, request: pending.request() })).status, 403);
  assert.equal((await redeem(link(), changed)).status, 400);
  assert.equal((await get({ env: changed, request: request('me', 'GET', null, cookie) })).status, 401);
  const disabled = { ...env, PORTAL_PREVIEW_MAIL_ENABLED: '0' };
  assert.equal((await get({ env: disabled, request: request('me', 'GET', null, cookie) })).status, 503);
  assert.equal((await get({ env: disabled, request: new Request(link()) })).status, 503);
});

test('current row email/status changes block existing QA sessions before profile or wellness reads/writes', async () => {
  await login(); const cookie = cookieOf(await redeem(link()));
  for (const sql of ["UPDATE caregiver SET email='changed@example.invalid' WHERE id=?",
    "UPDATE caregiver SET email='qa@example.invalid',status='archived' WHERE id=?"]) {
    raw.prepare(sql).run(QA);
    queries.length = 0;
    for (const action of ['me', 'wellness']) {
      assert.equal((await get({ env, request: request(action, 'GET', null, cookie) })).status, 401);
    }
    assert.equal((await post({ env, request: request('wellness', 'POST', { answers }, cookie) })).status, 401);
    assert.equal(queries.some(q => /wellness_checkin|grant_application|FROM registration|first_name/.test(q)), false);
  }
  assert.equal(count('wellness_checkin'), 0);
});

test('atomic claim also checks QA email if it changes after the lifecycle read', async () => {
  await login();
  beforeRun = sql => {
    if (sql.startsWith('UPDATE portal_token')) raw.prepare('UPDATE caregiver SET email=? WHERE id=?').run('changed@example.invalid', QA);
  };
  const response = await redeem(link());
  assert.equal(response.status, 400); assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 0);
});

test('QA confirmation retains strict origin, nonce, proof and single-use checks', async () => {
  await login(); const form = await prepareConfirmation(link(), env);
  for (const overrides of [{ headers: { Origin: 'null' } }, { headers: { Origin: 'https://other.example.invalid' } },
    { headers: { Cookie: '' } }, { values: { proof: '0'.repeat(64) } }, { values: { token: 'different_token' } }]) {
    assert.equal((await post({ env, request: form.request(overrides) })).status, 403);
    assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 0);
  }
  assert.equal((await post({ env, request: form.request() })).status, 302);
  assert.equal((await post({ env, request: form.request() })).status, 400);
});

for (const [name, result] of [['null', null], ['missing metadata', {}],
  ['unknown count', { meta: { changes: 0 } }], ['explicit failure', { success: false, meta: { changes: 1 } }]]) {
  test(`QA claim ${name} fails closed even if the underlying synthetic claim committed`, async () => {
    await login(); claimResponse = result;
    const response = await redeem(link());
    assert.equal(response.status, 400); assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 1, 'never reset an ambiguous claim');
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='portal.login_success'").get().n, 0);
    assert.equal((await redeem(link())).status, 400, 'uncertainty cannot become replay');
  });
}

test('QA token expiry is enforced without consuming it; missing sender readiness is uniform and never mints', async () => {
  insertToken('expired_qa_token', QA, prefix(env));
  raw.exec("UPDATE portal_token SET expires_at=datetime('now','-1 minute')");
  assert.equal((await redeem(`${ORIGIN}/api/portal/verify?token=expired_qa_token`)).status, 400);
  assert.equal(raw.prepare('SELECT used FROM portal_token').get().used, 0);
  for (const email of [EMAIL, 'other@example.invalid']) {
    queries.length = 0;
    const response = await login(email, { ...env, EMAIL_API_KEY: '' });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: 'signin_unavailable' });
    assert.equal(queries.some(q => /FROM caregiver/.test(q)), false);
  }
  assert.equal(count('portal_token'), 1); assert.equal(calls.length, 0);
});

test('production token/session format and general-mail policy ignore preview QA settings', async () => {
  const production = { ...env, ENVIRONMENT: 'production' };
  assert.equal(previewQACaregiver(production), null);
  assert.equal(canSendEmail(production), true);
  await login('other@example.invalid', production);
  const url = link(), token = new URL(url).searchParams.get('token');
  assert.equal(raw.prepare('SELECT caregiver_id FROM portal_token WHERE token_hash=?').get(hash(token)).caregiver_id, OTHER);
  const response = await redeem(url, production);
  assert.equal(response.status, 302);
  const value = decodeURIComponent(cookieOf(response).split('=')[1]);
  const [id, exp, sig] = value.split(':');
  assert.equal(id, OTHER);
  assert.equal(sig, createHmac('sha256', SECRET).update(`session:${id}:${exp}`).digest('hex'));
  assert.equal((await get({ env: production, request: request('me', 'GET', null, cookieOf(response)) })).status, 200);
});

test('disabled frontend feedback is explicit without revealing configured identity', async () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('function submitPortalLogin('), app.indexOf('function portalLogout('));
  const nodes = { loginEmail: { value: EMAIL }, loginStatus: { style: {} } };
  const button = { disabled: false };
  const submit = vm.runInNewContext(source + '\nsubmitPortalLogin;', {
    document: { getElementById: id => nodes[id], querySelector: () => button },
    fetch: async () => ({ status: 503, json: async () => ({ ok: false, error: 'preview_portal_disabled' }) }),
  });
  submit({ preventDefault() {}, target: { querySelector: () => button } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.loginStatus.textContent, /Staging caregiver sign-in is disabled/);
  assert.match(nodes.loginStatus.textContent, /specifically configured QA caregiver/);
  assert.doesNotMatch(nodes.loginStatus.textContent, /qa@example|fixture-qa/);
  assert.equal(button.disabled, false);
});
