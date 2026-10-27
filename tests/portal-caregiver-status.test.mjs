// Actual handler + prepared SQL over synthetic in-memory SQLite only. No
// provider, workerd, compiler, customer fixtures, subprocess or real secrets.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { confirmPortal } from './helpers/confirmed-portal.mjs';

const SECRET = 'synthetic-status-guard-key';
const ID = 'cg_status_synthetic';
const ORIGIN = 'https://status.synthetic.invalid';
const SCHEMAS = ['0001_init.sql', '0005_portal_login.sql', '0012_wellness_checkin.sql']
  .map(name => readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
let databases;
beforeEach(() => {
  databases = [];
  globalThis.fetch = async () => { throw new Error('Unexpected synthetic network call'); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const db of databases) db.close();
});

function fixture(status = 'active', options = {}) {
  const raw = new DatabaseSync(':memory:');
  databases.push(raw);
  for (const schema of SCHEMAS) raw.exec(schema);
  // Orphan tokens are an explicit synthetic negative fixture, not a live delete.
  raw.exec('PRAGMA foreign_keys = OFF');
  if (status !== 'missing') raw.prepare(`INSERT INTO caregiver (id, first_name, status, source)
    VALUES (?, 'Synthetic', ?, 'synthetic-status-test')`).run(ID, status);
  const effects = { statements: [], bodies: 0, claims: 0 };
  const db = { prepare(sql) {
    effects.statements.push(sql);
    if (options.guardError && sql.includes('SELECT id FROM caregiver')) {
      throw new Error('PRIVATE_SYNTHETIC_DB_ERROR');
    }
    const bound = params => ({
      async first() { return raw.prepare(sql).get(...params) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...params) }; },
      async run() {
        if (sql.includes('UPDATE portal_token')) {
          effects.claims++;
          options.beforeClaim?.(raw);
          if (options.claimError) throw new Error('PRIVATE_SYNTHETIC_CLAIM_ERROR');
        }
        const result = raw.prepare(sql).run(...params);
        if (sql.includes('UPDATE portal_token') && Object.hasOwn(options, 'claimResult')) {
          return options.claimResult;
        }
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    });
    return { bind: (...params) => bound(params), ...bound([]) };
  } };
  return { raw, effects, env: { LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET } };
}

function request(action, effects, { method = 'GET', cookie = null, token, body } = {}) {
  return {
    url: `${ORIGIN}/api/portal/${action}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    method,
    headers: { get: name => name.toLowerCase() === 'cookie' ? cookie : null },
    async json() {
      effects.bodies++;
      if (body === undefined) throw new Error('Body must not be parsed');
      return body;
    },
  };
}

async function signedCookie(id = ID) {
  const exp = Date.now() + 60_000;
  const message = `${id}:${exp}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${message}`));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
  return `portal_session=${encodeURIComponent(`${message}:${hex}`)}`;
}

async function freshToken(f, caregiverId = ID) {
  const value = 'synthetic-status-token';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const expiry = new Date(Date.now() + 60_000).toISOString().replace('T', ' ').slice(0, 19);
  f.raw.prepare('INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES (?, ?, ?, 0)')
    .run(hex, caregiverId, expiry);
  return value;
}

function assertNoLogin(f, response, used = 0) {
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(f.raw.prepare('SELECT used FROM portal_token').get().used, used);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='portal.login_success'").get().n, 0);
}

for (const status of ['missing', 'archived']) {
  test(`fresh token for ${status} caregiver refuses before claim, audit and cookie`, async () => {
    const f = fixture(status);
    const token = await freshToken(f);
    const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
    assert.equal(res.status, 400);
    assertNoLogin(f, res);
    assert.equal(f.effects.claims, 0);
  });

  for (const method of ['GET', 'POST']) test(`${method} wellness for ${status} caregiver denies before history/body/write`, async () => {
    const f = fixture(status);
    const cookie = await signedCookie();
    const handler = method === 'GET' ? onRequestGet : onRequestPost;
    const res = await handler({ env: f.env, request: request('wellness', f.effects, { method, cookie }) });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: 'unauthorized' });
    assert.equal(f.effects.bodies, 0);
    assert.equal(f.effects.statements.some(sql => /wellness_checkin|audit_log/.test(sql)), false);
    assert.equal(res.headers.get('Set-Cookie'), null);
  });
}

for (const status of ['active', 'inactive']) {
  test(`${status} preserves existing nonarchived token and wellness success contract`, async () => {
    const f = fixture(status);
    const token = await freshToken(f);
    const verify = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
    assert.equal(verify.status, 302);
    const cookie = verify.headers.get('Set-Cookie');
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=7200/);
    assert.equal(f.raw.prepare('SELECT used FROM portal_token').get().used, 1);
    const reused = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
    assert.equal(reused.status, 400);
    assert.equal(reused.headers.get('Set-Cookie'), null);
    const get = await onRequestGet({ env: f.env, request: request('wellness', f.effects, { cookie }) });
    assert.equal(get.status, 200);
    assert.deepEqual((await get.json()).history, []);
    const post = await onRequestPost({ env: f.env, request: request('wellness', f.effects, {
      method: 'POST', cookie, body: { answers: { stress: 3, sleep: 3, support: 3, self_time: 3 } },
    }) });
    assert.deepEqual(await post.json(), { ok: true, score: 50 });
    assert.equal(f.effects.bodies, 1);
  });
}

for (const removal of ['archive', 'delete']) test(`${removal} between lookup and claim cannot consume token`, async () => {
  const f = fixture('active', { beforeClaim(raw) {
    if (removal === 'archive') raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(ID);
    else raw.prepare('DELETE FROM caregiver WHERE id=?').run(ID);
  } });
  const token = await freshToken(f);
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(res.status, 400);
  assertNoLogin(f, res);
  assert.equal(f.effects.claims, 1);
  assert.match(f.effects.statements.find(sql => sql.includes('UPDATE portal_token')),
    /AND caregiver_id = \?[\s\S]*EXISTS[\s\S]*status != 'archived'/);
});

test('a previously valid signed cookie loses wellness access after archive without session-table mutation', async () => {
  const f = fixture();
  const cookie = await signedCookie();
  f.raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(ID);
  for (const [method, handler] of [['GET', onRequestGet], ['POST', onRequestPost]]) {
    const res = await handler({ env: f.env, request: request('wellness', f.effects, { method, cookie }) });
    assert.equal(res.status, 401);
  }
  assert.equal(f.effects.bodies, 0);
});

for (const action of ['verify', 'wellness-GET', 'wellness-POST']) test(`${action} identity-store failure fails closed before protected effects`, async () => {
  const f = fixture('active', { guardError: true });
  const token = await freshToken(f);
  const cookie = await signedCookie();
  const method = action === 'wellness-POST' ? 'POST' : 'GET';
  const handler = action === 'verify' ? confirmPortal : method === 'POST' ? onRequestPost : onRequestGet;
  const res = await handler({ env: f.env, request: request(action === 'verify' ? 'verify' : 'wellness', f.effects, { method, token, cookie }) });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, error: 'internal_error' });
  assertNoLogin(f, res);
  assert.equal(f.effects.bodies, 0);
  assert.equal(f.effects.claims, 0);
  assert.equal(f.effects.statements.some(sql => /wellness_checkin/.test(sql)), false);
});

test('claim-store failure issues no cookie or successful-login audit', async () => {
  const f = fixture('active', { claimError: true });
  const token = await freshToken(f);
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(res.status, 500);
  assertNoLogin(f, res);
});

for (const [name, claimResult] of [
  ['absent', undefined], ['missing meta', {}], ['missing changes', { meta: {} }],
  ['string changes', { meta: { changes: '1' } }], ['zero', { meta: { changes: 0 } }],
  ['multiple', { meta: { changes: 2 } }], ['reported failure', { success: false, meta: { changes: 1 } }],
]) test(`claim ${name} result fails closed even if the token update already committed`, async () => {
  const f = fixture('active', { claimResult });
  const token = await freshToken(f);
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(res.status, 400);
  assertNoLogin(f, res, 1); // Ambiguous metadata cannot safely undo a committed claim.
});

test('oversized signed caregiver ID is rejected before any identity-store query/body access', async () => {
  const f = fixture();
  const cookie = await signedCookie('x'.repeat(257));
  for (const [method, handler] of [['GET', onRequestGet], ['POST', onRequestPost]]) {
    assert.equal((await handler({ env: f.env,
      request: request('wellness', f.effects, { method, cookie }) })).status, 401);
  }
  assert.deepEqual(f.effects.statements, []);
  assert.equal(f.effects.bodies, 0);
});

test('oversized caregiver ID on a fresh token refuses before lookup or consumption', async () => {
  const f = fixture();
  const token = await freshToken(f, 'x'.repeat(257));
  const res = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(res.status, 400);
  assertNoLogin(f, res);
  assert.equal(f.effects.claims, 0);
  assert.equal(f.effects.statements.some(sql => sql.includes('FROM caregiver')), false);
});

test('mismatched identity lookup result cannot authorize a different caregiver', async () => {
  const f = fixture();
  const token = await freshToken(f);
  const prepare = f.env.LEGACY_DB.prepare.bind(f.env.LEGACY_DB);
  f.env.LEGACY_DB.prepare = sql => sql.includes('SELECT id FROM caregiver')
    ? { bind: () => ({ first: async () => ({ id: 'cg_other_synthetic' }) }) }
    : prepare(sql);
  const cookie = await signedCookie();
  const verify = await confirmPortal({ env: f.env, request: request('verify', f.effects, { token }) });
  assert.equal(verify.status, 400);
  assertNoLogin(f, verify);
  for (const [method, handler] of [['GET', onRequestGet], ['POST', onRequestPost]]) {
    assert.equal((await handler({ env: f.env,
      request: request('wellness', f.effects, { method, cookie }) })).status, 401);
  }
  assert.equal(f.effects.bodies, 0);
});
