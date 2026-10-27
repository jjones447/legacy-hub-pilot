// Response metadata over fake bindings only: no SQLite, provider, mail,
// customer data, compiler, workerd, browser, subprocess or network requests.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { confirmPortal } from './helpers/confirmed-portal.mjs';
import { QUESTIONS, CHECKIN_EVERY_DAYS } from '../functions/_lib/wellness.js';

const NOW = Date.parse('2026-10-14T02:00:00Z');
const ID = 'synthetic-cache-caregiver';
const SECRET = 'synthetic-cache-metadata-key';
const CLEAR_COOKIE = 'portal_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
let networkCalls;
beforeEach(() => {
  Date.now = () => NOW;
  networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected fake-test network'); };
});
afterEach(() => {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0, 'these metadata cases must never call a provider');
});

async function hmac(payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, enc.encode(`session:${payload}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function cookie(exp = NOW + 60_000) {
  const payload = `${ID}:${exp}`;
  return `portal_session=${encodeURIComponent(`${payload}:${await hmac(payload)}`)}`;
}

function fixture(options = {}) {
  const effects = { sql: [], bodies: 0 };
  const db = { prepare(sql) {
    effects.sql.push(sql);
    if (options.dbError) throw new Error('SYNTHETIC_STORE_DETAIL');
    const methods = {
      async first() {
        if (sql.includes('FROM portal_token')) {
          return Object.hasOwn(options, 'tokenRow') ? options.tokenRow : {
            caregiver_id: ID, used: 0, expires_at: '2026-10-14 02:10:00',
          };
        }
        if (sql.includes('SELECT id FROM caregiver')) return options.identityMissing ? null : { id: ID };
        if (sql.includes('SELECT id, first_name')) return options.identityMissing ? null : { id: ID };
        if (sql.includes('SELECT id, email FROM caregiver')) return null; // No mint/mail in metadata tests.
        if (sql.includes('COUNT(*)') && sql.includes('wellness_checkin')) return { n: options.recent ?? 0 };
        if (sql.includes('COUNT(*)') && sql.includes("action = 'portal.login_requested'")) return { n: options.emailLimit ?? 0 };
        if (sql.includes('COUNT(*)') && sql.includes('audit_log')) return { n: options.ipLimit ?? 0 };
        throw new Error('Unexpected fake first');
      },
      async all() {
        if (/FROM wellness_checkin|FROM grant_application|FROM registration/.test(sql)) return { results: [] };
        throw new Error('Unexpected fake all');
      },
      async run() {
        if (sql.includes('UPDATE portal_token')) return { success: true, meta: { changes: options.claimChanges ?? 1 } };
        if (/INSERT INTO audit_log|INSERT INTO wellness_checkin/.test(sql)) return { success: true, meta: { changes: 1 } };
        throw new Error('Unexpected fake run');
      },
    };
    return { bind: () => methods, ...methods };
  } };
  return { effects, env: { LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET } };
}
function request(action, effects, { method = 'GET', signedCookie = null, token, body, bodyError = false } = {}) {
  return {
    url: `https://cache.synthetic.invalid/api/portal/${action}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    method,
    headers: { get: name => name.toLowerCase() === 'cookie' ? signedCookie : null },
    async json() {
      effects.bodies++;
      if (bodyError) throw new Error('Synthetic invalid body');
      return body;
    },
  };
}

function expectHeaders(response, expected) {
  assert.deepEqual(Object.fromEntries(response.headers), { 'cache-control': 'no-store', ...expected });
}
async function expectJson(response, status, body, extra = {}) {
  assert.equal(response.status, status);
  expectHeaders(response, { 'content-type': 'application/json', ...extra });
  assert.equal(await response.text(), JSON.stringify(body), 'JSON bytes stay unchanged');
}
function expectedHtml(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Access Error</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="portal-error-body">
  <div class="portal-error-card">
    <h1 class="portal-error-title">Access Link Error</h1>
    <p class="portal-error-text">${message}</p>
    <a class="portal-error-link" href="/portal.html">Go to Login Page</a>
  </div>
</body>
</html>`;
}

for (const [method, handler] of [['GET', onRequestGet], ['POST', onRequestPost]]) {
  test(`${method} configuration503 and unknown404 JSON retain exact metadata`, async () => {
    const f = fixture();
    const req = request('unknown', f.effects, { method });
    await expectJson(await handler({ request: req, env: {} }), 503, { ok: false, error: 'auth_not_configured' });
    await expectJson(await handler({ request: req, env: f.env }), 404, { ok: false, error: 'not_found' });
  });

  test(`${method} generic500 retains exact JSON and no exception detail`, async () => {
    const f = fixture();
    const req = { ...request('unknown', f.effects, { method }), url: 'not a URL' };
    await expectJson(await handler({ request: req, env: f.env }), 500, { ok: false, error: 'internal_error' });
  });
}

for (const [method, action, handler] of [
  ['GET', 'me', onRequestGet], ['GET', 'wellness', onRequestGet], ['POST', 'wellness', onRequestPost],
]) test(`${method} ${action} unauthorized401 retains exact refusal and no cookie`, async () => {
  const f = fixture();
  await expectJson(await handler({ env: f.env, request: request(action, f.effects, { method }) }),
    401, { ok: false, error: 'unauthorized' });
});

test('profile404 and profile200 retain exact scoped JSON with no-store', async () => {
  const signedCookie = await cookie();
  const denied = fixture({ identityMissing: true });
  await expectJson(await onRequestGet({ env: denied.env, request: request('me', denied.effects, { signedCookie }) }),
    404, { ok: false, error: 'profile_not_found' });
  const ok = fixture();
  await expectJson(await onRequestGet({ env: ok.env, request: request('me', ok.effects, { signedCookie }) }),
    200, { ok: true, profile: { id: ID }, grants: [], events: [] });
});

test('wellnessGET200 empty synthetic history retains the existing response', async () => {
  const f = fixture();
  await expectJson(await onRequestGet({ env: f.env, request: request('wellness', f.effects, { signedCookie: await cookie() }) }),
    200, { ok: true, history: [], due: true, every_days: CHECKIN_EVERY_DAYS, questions: QUESTIONS });
});

test('wellnessPOST400 invalid-body and429 daily refusal retain JSON', async () => {
  const signedCookie = await cookie();
  const f = fixture();
  await expectJson(await onRequestPost({ env: f.env,
    request: request('wellness', f.effects, { method: 'POST', signedCookie, bodyError: true }) }),
    400, { ok: false, error: 'invalid_body' });
  const limited = fixture({ recent: 1 });
  await expectJson(await onRequestPost({ env: limited.env,
    request: request('wellness', limited.effects, { method: 'POST', signedCookie,
      body: { answers: { stress: 3, sleep: 3, support: 3, self_time: 3 } } }) }),
    429, { ok: false, error: 'You already checked in today. Thank you!' });
});

test('wellnessPOST200 fake write retains score JSON', async () => {
  const f = fixture();
  await expectJson(await onRequestPost({ env: f.env,
    request: request('wellness', f.effects, { method: 'POST', signedCookie: await cookie(),
      body: { answers: { stress: 3, sleep: 3, support: 3, self_time: 3 } } }) }),
    200, { ok: true, score: 50 });
});

for (const [name, options, body, extraEnv, status, response] of [
  ['invalid email', {}, { email: 'invalid' }, {}, 400, { ok: false, error: 'invalid_email' }],
  ['IP rate limit', { ipLimit: 20 }, { email: 'nobody@example.invalid' }, {}, 429, { ok: false, error: 'rate_limited' }],
  ['unavailable email', {}, { email: 'nobody@example.invalid' }, {}, 503, { ok: false, error: 'signin_unavailable' }],
  ['unknown email', {}, { email: 'nobody@example.invalid' }, { EMAIL_API_KEY: 'synthetic-not-used' }, 200, { ok: true }],
]) test(`login ${name} retains exact JSON without mint/mail`, async () => {
  const f = fixture(options);
  await expectJson(await onRequestPost({ env: { ...f.env, ...extraEnv },
    request: request('login', f.effects, { method: 'POST', body }) }), status, response);
});

for (const [name, options, token, message] of [
  ['missing token', {}, undefined, 'Missing verification token.'],
  ['unknown token', { tokenRow: null }, 'synthetic-token', 'This access link is unrecognized or has been revoked.'],
  ['used token', { tokenRow: { caregiver_id: ID, used: 1 } }, 'synthetic-token', 'This access link has already been used.'],
  ['expired token', { tokenRow: { caregiver_id: ID, used: 0, expires_at: '2020-01-01 00:00:00' } }, 'synthetic-token', 'This access link has expired (15-minute limit).'],
  ['missing identity', { identityMissing: true }, 'synthetic-token', 'This access link is unrecognized or has been revoked.'],
  ['conditional claim refused', { claimChanges: 0 }, 'synthetic-token', 'This access link is unavailable or has already been used.'],
]) test(`verify ${name} keeps exact HTML400 body/headers`, async () => {
  const f = fixture(options);
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(res.status, 400);
  expectHeaders(res, { 'content-type': 'text/html; charset=utf-8' });
  assert.equal(await res.text(), expectedHtml(message));
});

test('confirmationPOST302 preserves null body, exact Location and entire signed cookie', async () => {
  const f = fixture();
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token: 'synthetic-token' }) });
  assert.equal(res.status, 302);
  assert.equal(res.body, null);
  const exp = NOW + 2 * 60 * 60 * 1000;
  const payload = `${ID}:${exp}`;
  expectHeaders(res, { location: '/portal.html',
    'set-cookie': `portal_session=${encodeURIComponent(`${payload}:${await hmac(payload)}`)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200` });
});

test('production logout200 preserves exact body and clear-cookie fields', async () => {
  const f = fixture();
  await expectJson(await onRequestPost({ env: f.env,
    request: request('logout', f.effects, { method: 'POST', signedCookie: await cookie() }) }),
    200, { ok: true }, { 'set-cookie': CLEAR_COOKIE });
});

for (const environment of ['preview', 'development']) {
  test(`${environment} all GET/POST responses retain zero identity/binding/body effects and no-store`, async () => {
    const effects = [];
    const env = { ENVIRONMENT: environment, PORTAL_DEV_RETURN_LINK: '1' };
    for (const name of ['LEGACY_DB', 'PORTAL_TOKEN_SECRET', 'EMAIL_API_KEY']) {
      Object.defineProperty(env, name, { get() { effects.push(name); throw new Error('Unexpected binding read'); } });
    }
    for (const [method, handler] of [['GET', onRequestGet], ['POST', onRequestPost]]) {
      for (const action of ['login', 'verify', 'me', 'wellness', 'unknown', 'logout']) {
        const req = request(action, { bodies: 0 }, { method });
        req.headers.get = () => { effects.push('cookie/header'); throw new Error('Unexpected identity read'); };
        req.json = async () => { effects.push('body'); throw new Error('Unexpected body read'); };
        const res = await handler({ env, request: req });
        if (method === 'POST' && action === 'logout') {
          await expectJson(res, 200, { ok: true }, { 'set-cookie': CLEAR_COOKIE });
        } else {
          await expectJson(res, 503, { ok: false, error: 'preview_portal_disabled' });
        }
      }
    }
    assert.deepEqual(effects, []);
  });
}
