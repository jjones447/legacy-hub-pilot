// Slice 09 integration tests — Portal login v0 (magic-link).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getPortal, onRequestPost as postPortal, onRequestHead as headPortal } from '../functions/api/portal/[[path]].js';
import { confirmPortal, prepareConfirmation } from './helpers/confirmed-portal.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_5 = readFileSync(new URL('../schema/0005_portal_login.sql', import.meta.url), 'utf8');

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
              const r = db.prepare(sql).run(...params);
              return { ...r, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
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
          const r = db.prepare(sql).run();
          return { ...r, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
        async all() {
          return { results: db.prepare(sql).all() };
        }
      };
    }
  };
}

function mockRequest(urlStr, method = 'GET', body = null, cookie = null) {
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'cookie') return cookie;
        return null;
      }
    },
    async json() {
      if (!body) throw new Error('no body');
      return body;
    }
  };
}

let raw;
let env;
let emailedLink;
const realFetch = globalThis.fetch;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_5);
  env = {
    LEGACY_DB: d1(raw),
    PORTAL_TOKEN_SECRET: 'my_test_secret_key',
    EMAIL_API_KEY: 'synthetic-email-key'
  };
  emailedLink = null;
  globalThis.fetch = async (_url, init) => {
    emailedLink = JSON.parse(init.body).text.match(/https?:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
    return { ok: true, status: 200 };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('non-member email returns generic response and does not mint token', async () => {
  const req = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'unknown@example.com' });
  const res = await postPortal({ request: req, env });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.dev_link, undefined);

  // Verify DB has no tokens
  const countRow = raw.prepare('SELECT COUNT(*) AS n FROM portal_token').get();
  assert.equal(countRow.n, 0);

  // Check audit log row exists
  const auditRow = raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.login_requested'").get();
  assert.equal(auditRow.n, 1);
});

test('member email is mocked as mailed, never returned, and inserts hashed token into D1', async () => {
  // cg_seed_fictional has email jane.doe@example.com in schema 3
  const req = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res = await postPortal({ request: req, env });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.dev_link, undefined);
  assert.ok(emailedLink.includes('/api/portal/verify?token='));

  // The link token is opaque: no caregiver id, no ':' payload separators
  const token = new URL(emailedLink).searchParams.get('token');
  assert.ok(token);
  assert.ok(!token.includes(':'));
  assert.ok(!token.includes('cg_seed_fictional'));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  // Verify DB has 1 token
  const countRow = raw.prepare('SELECT COUNT(*) AS n FROM portal_token').get();
  assert.equal(countRow.n, 1);

  const tokenRow = raw.prepare('SELECT used, caregiver_id FROM portal_token').get();
  assert.equal(tokenRow.used, 0);
  assert.equal(tokenRow.caregiver_id, 'cg_seed_fictional');
});

test('explicit confirmation POST validates token, sets session, and blocks reuse', async () => {
  // 1. Request token
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  const verifyUrl = new URL(emailedLink);
  const token = verifyUrl.searchParams.get('token');

  // 2. Verify token
  const req2 = mockRequest(verifyUrl.toString(), 'GET');
  const res2 = await confirmPortal({ request: req2, env });

  assert.equal(res2.status, 302);
  assert.equal(res2.headers.get('Location'), '/portal.html');
  const cookie = res2.headers.get('Set-Cookie');
  assert.ok(cookie);
  assert.ok(cookie.includes('portal_session='));
  assert.ok(cookie.includes('HttpOnly'));

  // Verify DB token is marked used
  const tokenRow = raw.prepare('SELECT used FROM portal_token').get();
  assert.equal(tokenRow.used, 1);

  // Check login success audit
  const auditRow = raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.login_success' AND entity_id = 'cg_seed_fictional'").get();
  assert.equal(auditRow.n, 1);

  // 3. Try to reuse same token -> should be rejected with friendly html error
  const req3 = mockRequest(verifyUrl.toString(), 'GET');
  const res3 = await confirmPortal({ request: req3, env });
  assert.equal(res3.status, 400);
  const bodyText = await res3.text();
  assert.ok(bodyText.includes('already been used'));
});

test('gated me API returns caregiver-scoped data and rejects unauthorized request', async () => {
  // 1. Get a valid cookie
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  
  const req2 = mockRequest(emailedLink, 'GET');
  const res2 = await confirmPortal({ request: req2, env });
  const cookie = res2.headers.get('Set-Cookie');

  // 2. Request gated /me with cookie
  const req3 = mockRequest('http://localhost/api/portal/me', 'GET', null, cookie);
  const res3 = await getPortal({ request: req3, env });

  assert.equal(res3.status, 200);
  const meData = await res3.json();
  assert.equal(meData.ok, true);
  assert.equal(meData.profile.id, 'cg_seed_fictional');
  assert.equal(meData.profile.first_name, 'Jane');
  assert.equal(meData.grants.length, 1); // 1001 Day respite care seeded in schema 3
  assert.equal(meData.grants[0].requested_for, 'Day respite care');

  // 3. Request gated /me without cookie -> 401
  const req4 = mockRequest('http://localhost/api/portal/me', 'GET');
  const res4 = await getPortal({ request: req4, env });
  assert.equal(res4.status, 401);

  // 4. Request gated /me with invalid signature cookie -> 401
  const badCookie = cookie.replace(/portal_session=[^;]+/, 'portal_session=cg_seed_fictional:9999999999:badsignature');
  const req5 = mockRequest('http://localhost/api/portal/me', 'GET', null, badCookie);
  const res5 = await getPortal({ request: req5, env });
  assert.equal(res5.status, 401);
});

test('account grants are newest-first with a stable ID tie-break and exclude another caregiver', async () => {
  raw.exec("INSERT INTO caregiver (id, first_name, last_name, email, source) VALUES ('other','Other','Person','other@example.invalid','seed')");
  const insert = raw.prepare('INSERT INTO grant_application (id, caregiver_id, requested_for, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(2001, 'cg_seed_fictional', 'Older', 'submitted', 'seed', '2025-01-01 12:00:00');
  insert.run(2002, 'cg_seed_fictional', 'Newer', 'in_review', 'seed', '2099-10-13 12:00:00');
  insert.run(2003, 'cg_seed_fictional', 'Same-date newest ID', 'submitted', 'seed', '2099-10-13 12:00:00');
  insert.run(2004, 'other', 'Private other grant', 'submitted', 'seed', '2100-01-01 12:00:00');
  const login = await postPortal({ request: mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' }), env });
  const token = await login.json();
  assert.deepEqual(token, { ok: true });
  const verify = await confirmPortal({ request: mockRequest(emailedLink), env });
  const response = await getPortal({ request: mockRequest('http://localhost/api/portal/me', 'GET', null, verify.headers.get('Set-Cookie')), env });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.grants.slice(0, 2).map(grant => grant.id), [2003, 2002]);
  assert.equal(data.grants.at(-1).id, 2001);
  assert.ok(data.grants.every(grant => grant.id !== 2004));
  assert.equal(data.grants[0].requested_for, 'Same-date newest ID');
});

test('SEC-3: a magic-link token cannot be pasted directly as a session cookie', async () => {
  // Attacker obtains a raw magic-link token (leaked link, referrer, etc.)
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  const token = new URL(emailedLink).searchParams.get('token');

  // ...and pastes it straight into portal_session, skipping /verify (and its single-use check)
  const forgedCookie = `portal_session=${encodeURIComponent(token)}`;
  const req2 = mockRequest('http://localhost/api/portal/me', 'GET', null, forgedCookie);
  const res2 = await confirmPortal({ request: req2, env });

  // The opaque token is not an `id:exp:session-hmac` value, so it fails
  // session-cookie parsing. Pre-fix (shared secret + format) this returned 200
  // with the caregiver's data.
  assert.equal(res2.status, 401);
});

test('two simultaneous confirmation POSTs: exactly one signs in', async () => {
  const res1 = await postPortal({ request: mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' }), env });
  assert.deepEqual(await res1.json(), { ok: true });
  const link = emailedLink;
  // Hold both token lookups until both have read the row, so both see used = 0 and then race to claim it.
  let arrived = 0;
  let release;
  const bothRead = new Promise((r) => { release = r; });
  const racingDb = {
    prepare(sql) {
      const stmt = env.LEGACY_DB.prepare(sql);
      if (!/SELECT caregiver_id, used, expires_at FROM portal_token/.test(sql)) return stmt;
      return {
        bind(...p) {
          const bound = stmt.bind(...p);
          return { ...bound, async first() { const row = await bound.first(); if (++arrived === 2) release(); await bothRead; return row; } };
        },
      };
    },
  };
  const raceEnv = { ...env, LEGACY_DB: racingDb };
  const [a, b] = await Promise.all([
    confirmPortal({ request: mockRequest(link, 'GET'), env: raceEnv }),
    confirmPortal({ request: mockRequest(link, 'GET'), env: raceEnv }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [302, 400]);
  const signedIn = [a, b].filter((r) => (r.headers.get('Set-Cookie') || '').includes('portal_session=') && r.status === 302);
  assert.equal(signedIn.length, 1);
});

test('verify rejects a random token that was never minted', async () => {
  const req = mockRequest('http://localhost/api/portal/verify?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'GET');
  const res = await confirmPortal({ request: req, env });
  assert.equal(res.status, 400);
  const bodyText = await res.text();
  assert.ok(bodyText.includes('unrecognized'));
});

test('verify rejects a token whose row is expired', async () => {
  const token = 'expired-opaque-token-value';
  const tokenHash = await sha256Hex(token);
  const past = new Date(Date.now() - 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  raw.prepare('INSERT INTO portal_token (token_hash, caregiver_id, expires_at, used) VALUES (?, ?, ?, 0)')
    .run(tokenHash, 'cg_seed_fictional', past);

  const req = mockRequest(`http://localhost/api/portal/verify?token=${token}`, 'GET');
  const res = await confirmPortal({ request: req, env });
  assert.equal(res.status, 400);
  const bodyText = await res.text();
  assert.ok(bodyText.includes('expired'));
});

test('logout api clears the session cookie and logs logout audit', async () => {
  // 1. Get a cookie
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  
  const req2 = mockRequest(emailedLink, 'GET');
  const res2 = await confirmPortal({ request: req2, env });
  const cookie = res2.headers.get('Set-Cookie');

  // 2. Call logout
  const req3 = mockRequest('http://localhost/api/portal/logout', 'POST', null, cookie);
  const res3 = await postPortal({ request: req3, env });

  assert.equal(res3.status, 200);
  const logoutCookie = res3.headers.get('Set-Cookie');
  assert.ok(logoutCookie);
  assert.ok(logoutCookie.includes('Max-Age=0'));

  // Check audit log logout row
  const auditRow = raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.logout' AND actor = 'cg_seed_fictional'").get();
  assert.equal(auditRow.n, 1);
});

test('auth fails closed with 503 when PORTAL_TOKEN_SECRET is missing', async () => {
  const envNoSecret = {
    LEGACY_DB: d1(raw),
    PORTAL_TOKEN_SECRET: undefined,
    PORTAL_DEV_RETURN_LINK: 1
  };

  // POST login fails
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env: envNoSecret });
  assert.equal(res1.status, 503);
  const data1 = await res1.json();
  assert.equal(data1.ok, false);
  assert.equal(data1.error, 'auth_not_configured');

  // GET verify fails
  const req2 = mockRequest('http://localhost/api/portal/verify?token=somepayload', 'GET');
  const res2 = await getPortal({ request: req2, env: envNoSecret });
  assert.equal(res2.status, 503);
  const data2 = await res2.json();
  assert.equal(data2.ok, false);
  assert.equal(data2.error, 'auth_not_configured');

  // GET me fails
  const req3 = mockRequest('http://localhost/api/portal/me', 'GET');
  const res3 = await getPortal({ request: req3, env: envNoSecret });
  assert.equal(res3.status, 503);
  const data3 = await res3.json();
  assert.equal(data3.ok, false);
  assert.equal(data3.error, 'auth_not_configured');
});

// --- Error bodies, session expiry parsing, per-IP request limits ---

async function hmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sessionCookieFor(caregiverId, exp, secret) {
  const sig = await hmacHex(`session:${caregiverId}:${exp}`, secret);
  return `portal_session=${encodeURIComponent(`${caregiverId}:${exp}:${sig}`)}`;
}

function ipRequest(urlStr, method, body, ip, cookie = null) {
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        const n = name.toLowerCase();
        if (n === 'cookie') return cookie;
        if (n === 'cf-connecting-ip') return ip;
        return null;
      }
    },
    async json() {
      if (!body) throw new Error('no body');
      return body;
    }
  };
}

test('500 responses return a generic error and never the exception text', async () => {
  const boom = { prepare() { throw new Error('SQLITE_ERROR: internal detail xyz'); } };
  const envBoom = { ...env, LEGACY_DB: boom };
  const cookie = await sessionCookieFor('cg_seed_fictional', Date.now() + 60_000, env.PORTAL_TOKEN_SECRET);

  const resGet = await getPortal({ request: mockRequest('http://localhost/api/portal/me', 'GET', null, cookie), env: envBoom });
  assert.equal(resGet.status, 500);
  const textGet = await resGet.text();
  assert.ok(!textGet.includes('internal detail'));
  assert.equal(JSON.parse(textGet).error, 'internal_error');

  const resPost = await postPortal({ request: mockRequest('http://localhost/api/portal/logout', 'POST', null, cookie), env: envBoom });
  assert.equal(resPost.status, 500);
  const textPost = await resPost.text();
  assert.ok(!textPost.includes('internal detail'));
  assert.equal(JSON.parse(textPost).error, 'internal_error');
});

test('a correctly signed session cookie with a non-finite expiry is rejected', async () => {
  for (const exp of ['Infinity', 'NaN', 'abc']) {
    const cookie = await sessionCookieFor('cg_seed_fictional', exp, env.PORTAL_TOKEN_SECRET);
    const res = await getPortal({ request: mockRequest('http://localhost/api/portal/me', 'GET', null, cookie), env });
    assert.equal(res.status, 401, `exp=${exp}`);
  }
});

test('login is limited to 20 requests per IP per 15 minutes, across different emails', async () => {
  for (let i = 0; i < 20; i++) {
    const res = await postPortal({ request: ipRequest('http://localhost/api/portal/login', 'POST', { email: `rotating${i}@example.com` }, '203.0.113.7'), env });
    assert.equal(res.status, 200, `request ${i + 1}`);
  }
  const blocked = await postPortal({ request: ipRequest('http://localhost/api/portal/login', 'POST', { email: 'rotating21@example.com' }, '203.0.113.7'), env });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'rate_limited');

  const otherIp = await postPortal({ request: ipRequest('http://localhost/api/portal/login', 'POST', { email: 'rotating22@example.com' }, '198.51.100.9'), env });
  assert.equal(otherIp.status, 200);
});

test('login fails closed with 503 when the request-limit store errors', async () => {
  let tokenInserts = 0;
  const base = env.LEGACY_DB;
  const flaky = {
    prepare(sql) {
      if (/audit_log/.test(sql)) throw new Error('store down');
      if (/INSERT INTO portal_token/.test(sql)) tokenInserts++;
      return base.prepare(sql);
    }
  };
  const res = await postPortal({ request: ipRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' }, '203.0.113.7'), env: { ...env, LEGACY_DB: flaky } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unavailable');
  assert.equal(tokenInserts, 0);
});

test('the per-IP limiter binds and stores only a hashed IP, never the raw address', async () => {
  const ip = '203.0.113.77';
  const seen = [];
  const base = env.LEGACY_DB;
  const spy = {
    prepare(sql) {
      const st = base.prepare(sql);
      return { ...st, bind(...params) { seen.push(...params); return st.bind(...params); } };
    }
  };
  const res = await postPortal({ request: ipRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' }, ip), env: { ...env, LEGACY_DB: spy } });
  assert.equal(res.status, 200);
  assert.ok(!seen.some(v => typeof v === 'string' && v.includes(ip)));

  const expected = await sha256Hex('ip:' + ip);
  const hashed = raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.login_ip' AND actor = ?").get(expected);
  assert.equal(hashed.n, 1);
  const leak = raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor LIKE ? OR IFNULL(entity_id, '') LIKE ? OR IFNULL(after_json, '') LIKE ?").get(`%${ip}%`, `%${ip}%`, `%${ip}%`);
  assert.equal(leak.n, 0);
});

// Actual handlers, native Request/Response and fictional in-memory SQLite only.
// globalThis.fetch remains the existing mocked mail transport above.
async function mintedConfirmation() {
  const minted = await postPortal({ request: mockRequest('https://portal.synthetic.invalid/api/portal/login',
    'POST', { email: 'jane.doe@example.com' }), env });
  assert.equal(minted.status, 200);
  return prepareConfirmation(emailedLink, env);
}

function loginCounts() {
  return {
    used: raw.prepare('SELECT SUM(used) AS n FROM portal_token').get().n,
    audits: raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='portal.login_success'").get().n,
  };
}

test('prefetch GET and HEAD cannot consume a link before the intended browser confirms', async () => {
  await mintedConfirmation();
  const queries = [];
  const original = env.LEGACY_DB.prepare;
  env.LEGACY_DB.prepare = sql => { queries.push(sql); return original(sql); };
  for (const headers of [{}, { Purpose: 'prefetch' }, { 'Sec-Purpose': 'prefetch;prerender' }]) {
    const get = await getPortal({ env, request: new Request(emailedLink, { headers }) });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('Cache-Control'), 'no-store');
    assert.equal(get.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(get.headers.get('Content-Security-Policy'), /form-action 'self'/);
    assert.match(get.headers.get('Set-Cookie'), /^__Host-portal_confirm=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=900$/);
    assert.doesNotMatch(get.headers.get('Set-Cookie'), /portal_session=|Domain=/i);
    const html = await get.text();
    assert.match(html, /<form method="post" action="\/api\/portal\/verify">/);
    assert.doesNotMatch(html, /<script|onload=|localStorage|sessionStorage|auto.?submit/i);
    const head = await headPortal({ env, request: new Request(emailedLink, { method: 'HEAD', headers }) });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('Set-Cookie'), null);
  }
  assert.deepEqual(queries, [], 'landing and HEAD cannot even query token or caregiver state');
  assert.deepEqual(loginCounts(), { used: 0, audits: 0 });
  const intended = await prepareConfirmation(emailedLink, env);
  const result = await postPortal({ env, request: intended.request() });
  assert.equal(result.status, 302);
  assert.deepEqual(loginCounts(), { used: 1, audits: 1 });
});

test('a browser refresh reuses its nonce so another landing does not invalidate its unsubmitted form', async () => {
  const first = await mintedConfirmation();
  const refreshed = await prepareConfirmation(emailedLink, env, first.cookie);
  assert.equal(first.values.csrf, refreshed.values.csrf);
  assert.equal(first.values.proof, refreshed.values.proof);
  assert.equal((await postPortal({ env, request: first.request() })).status, 302);
});

test('two independent browser confirmations have exactly one token winner and login audit', async () => {
  const a = await mintedConfirmation();
  const b = await prepareConfirmation(emailedLink, env);
  assert.notEqual(a.cookie, b.cookie);
  const replies = await Promise.all([a, b].map(form => postPortal({ env, request: form.request() })));
  assert.deepEqual(replies.map(res => res.status).sort(), [302, 400]);
  assert.equal(replies.filter(res => res.headers.get('Set-Cookie')?.startsWith('portal_session=')).length, 1);
  assert.deepEqual(loginCounts(), { used: 1, audits: 1 });
});

for (const [name, origin, target = 'https://portal.synthetic.invalid/api/portal/verify'] of [
  ['missing', null], ['literal null', 'null'], ['foreign', 'https://foreign.synthetic.invalid'],
  ['suffix', 'https://portal.synthetic.invalid.evil.invalid'],
  ['duplicate', 'https://portal.synthetic.invalid, https://portal.synthetic.invalid'],
  ['different port', 'https://portal.synthetic.invalid:444'],
  ['opaque URL null', 'null', 'data:/api/portal/verify'],
]) test(`confirmation ${name} Origin refuses before cookie, body, secret or store access`, async () => {
  const reads = [];
  const request = { url: target, method: 'POST',
    headers: { get(name) { reads.push(name); if (name !== 'Origin') throw new Error('Must not read another header'); return origin; } },
    get body() { throw new Error('Must not read body'); },
  };
  const guardedEnv = { get PORTAL_TOKEN_SECRET() { throw new Error('Must not read secret'); },
    get LEGACY_DB() { throw new Error('Must not read database'); } };
  const response = await postPortal({ env: guardedEnv, request });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'forbidden' });
  assert.deepEqual(reads, ['Origin']);
});

for (const [name, change] of [
  ['missing cookie', form => ({ headers: { Cookie: '' } })],
  ['duplicate cookie', form => ({ headers: { Cookie: `${form.cookie}; ${form.cookie}` } })],
  ['wrong nonce', form => ({ values: { csrf: 'A'.repeat(43) } })],
  ['wrong proof', form => ({ values: { proof: '0'.repeat(64) } })],
  ['token substitution', form => ({ values: { token: 'other-synthetic-token' } })],
  ['JSON body', form => ({ headers: { 'Content-Type': 'application/json' }, body: '{}' })],
  ['oversized body despite small content length', form => ({ headers: { 'Content-Length': '1' }, body: 'x'.repeat(1025) })],
  ['duplicate field', form => ({ body: new URLSearchParams([...Object.entries(form.values), ['proof', form.values.proof]]) })],
  ['extra field', form => ({ body: new URLSearchParams({ ...form.values, extra: 'no' }) })],
  ['missing field', form => ({ body: new URLSearchParams({ token: form.values.token, csrf: form.values.csrf }) })],
]) test(`confirmation ${name} cannot touch identity/token state or issue a session`, async () => {
  const form = await mintedConfirmation();
  const original = env.LEGACY_DB.prepare;
  const queries = [];
  env.LEGACY_DB.prepare = sql => { queries.push(sql); return original(sql); };
  const response = await postPortal({ env, request: form.request(change(form)) });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(queries, []);
  assert.deepEqual(loginCounts(), { used: 0, audits: 0 });
});

test('one browser cannot use another browser nonce, but its own explicit confirmation still works', async () => {
  const a = await mintedConfirmation();
  const b = await prepareConfirmation(emailedLink, env);
  assert.equal((await postPortal({ env, request: a.request({ headers: { Cookie: b.cookie } }) })).status, 403);
  assert.deepEqual(loginCounts(), { used: 0, audits: 0 });
  assert.equal((await postPortal({ env, request: b.request() })).status, 302);
});

test('expiry and archive after landing are rechecked at confirmation without consuming the token', async () => {
  const form = await mintedConfirmation();
  raw.prepare("UPDATE portal_token SET expires_at='2020-01-01 00:00:00'").run();
  let response = await postPortal({ env, request: form.request() });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /expired/);
  assert.deepEqual(loginCounts(), { used: 0, audits: 0 });
  raw.prepare('UPDATE portal_token SET expires_at=?').run(new Date(Date.now() + 60_000).toISOString().replace('T', ' ').slice(0, 19));
  raw.prepare("UPDATE caregiver SET status='archived' WHERE id='cg_seed_fictional'").run();
  response = await postPortal({ env, request: form.request() });
  assert.equal(response.status, 400);
  assert.deepEqual(loginCounts(), { used: 0, audits: 0 });
});

test('post-claim login-audit failure stays consumed and fail-closed, never reset for reuse', async () => {
  const form = await mintedConfirmation();
  raw.exec("CREATE TRIGGER synthetic_login_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action='portal.login_success' BEGIN SELECT RAISE(ABORT,'PRIVATE_SYNTHETIC_AUDIT_FAILURE'); END;");
  const response = await postPortal({ env, request: form.request() });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
  assert.deepEqual(loginCounts(), { used: 1, audits: 0 });
  const later = await prepareConfirmation(emailedLink, env);
  assert.equal((await postPortal({ env, request: later.request() })).status, 400);
  assert.deepEqual(loginCounts(), { used: 1, audits: 0 });
});

test('a lost successful response cannot mint a second session, and the issued cookie remains scoped', async () => {
  const form = await mintedConfirmation();
  const first = await postPortal({ env, request: form.request() });
  assert.equal(first.status, 302);
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=7200$/);
  const retry = await postPortal({ env, request: form.request() });
  assert.equal(retry.status, 400);
  assert.equal(retry.headers.get('Set-Cookie'), null);
  assert.deepEqual(loginCounts(), { used: 1, audits: 1 });
  const me = await getPortal({ env, request: mockRequest('https://portal.synthetic.invalid/api/portal/me', 'GET', null, cookie) });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).profile.id, 'cg_seed_fictional');
  const logout = await postPortal({ env, request: mockRequest('https://portal.synthetic.invalid/api/portal/logout', 'POST', null, cookie) });
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('invalid or duplicate token query values never enter the landing HTML or database', async () => {
  const forbidden = { prepare() { throw new Error('No token query allowed'); } };
  for (const query of ['token=%22%3E%3Cscript%3E', 'token=a&token=b', `token=${'A'.repeat(129)}`]) {
    const response = await getPortal({ env: { ...env, LEGACY_DB: forbidden },
      request: new Request(`https://portal.synthetic.invalid/api/portal/verify?${query}`) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.doesNotMatch(await response.text(), /<script>/);
  }
});

for (const environment of ['preview', 'development']) test(`${environment} confirmation GET/HEAD/POST refuses before all bindings and headers`, async () => {
  const noEffects = { ENVIRONMENT: environment };
  for (const name of ['PORTAL_TOKEN_SECRET', 'LEGACY_DB', 'EMAIL_API_KEY']) {
    Object.defineProperty(noEffects, name, { get() { throw new Error('Forbidden synthetic binding access'); } });
  }
  for (const [method, handler] of [['GET', getPortal], ['HEAD', headPortal], ['POST', postPortal]]) {
    const request = { url: 'https://portal.synthetic.invalid/api/portal/verify?token=synthetic-token', method,
      headers: { get() { throw new Error('Forbidden synthetic header access'); } },
      get body() { throw new Error('Forbidden synthetic body access'); } };
    const response = await handler({ env: noEffects, request });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.deepEqual(await response.json(), { ok: false, error: 'preview_portal_disabled' });
  }
});
