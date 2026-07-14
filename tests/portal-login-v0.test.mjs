// Slice 09 integration tests — Portal login v0 (magic-link).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getPortal, onRequestPost as postPortal } from '../functions/api/portal/[[path]].js';

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

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_5);
  env = {
    LEGACY_DB: d1(raw),
    PORTAL_TOKEN_SECRET: 'my_test_secret_key',
    PORTAL_DEV_RETURN_LINK: 1
  };
});

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

test('member email returns dev_link and inserts hashed token into D1', async () => {
  // cg_seed_fictional has email jane.doe@example.com in schema 3
  const req = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res = await postPortal({ request: req, env });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.dev_link);
  assert.ok(data.dev_link.includes('/api/portal/verify?token='));

  // Verify DB has 1 token
  const countRow = raw.prepare('SELECT COUNT(*) AS n FROM portal_token').get();
  assert.equal(countRow.n, 1);

  const tokenRow = raw.prepare('SELECT used, caregiver_id FROM portal_token').get();
  assert.equal(tokenRow.used, 0);
  assert.equal(tokenRow.caregiver_id, 'cg_seed_fictional');
});

test('verify endpoint validates good token, sets session cookie, redirects, and blocks reuse', async () => {
  // 1. Request token
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  const verifyUrl = new URL('http://localhost' + data1.dev_link);
  const token = verifyUrl.searchParams.get('token');

  // 2. Verify token
  const req2 = mockRequest(verifyUrl.toString(), 'GET');
  const res2 = await getPortal({ request: req2, env });

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
  const res3 = await getPortal({ request: req3, env });
  assert.equal(res3.status, 400);
  const bodyText = await res3.text();
  assert.ok(bodyText.includes('already been used'));
});

test('gated me API returns caregiver-scoped data and rejects unauthorized request', async () => {
  // 1. Get a valid cookie
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  
  const req2 = mockRequest('http://localhost' + data1.dev_link, 'GET');
  const res2 = await getPortal({ request: req2, env });
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

test('logout api clears the session cookie and logs logout audit', async () => {
  // 1. Get a cookie
  const req1 = mockRequest('http://localhost/api/portal/login', 'POST', { email: 'jane.doe@example.com' });
  const res1 = await postPortal({ request: req1, env });
  const data1 = await res1.json();
  
  const req2 = mockRequest('http://localhost' + data1.dev_link, 'GET');
  const res2 = await getPortal({ request: req2, env });
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
