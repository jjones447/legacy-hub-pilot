// Caregiver sign-in email (Resend). Production only; staging never sends; the response never
// reveals whether an email address belongs to a Legacy client.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canSendEmail, signInEmail, sendEmail, EMAIL_FROM, EMAIL_REPLY_TO } from '../functions/_lib/email.js';
import { onRequestPost as postPortal } from '../functions/api/portal/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_5 = readFileSync(new URL('../schema/0005_portal_login.sql', import.meta.url), 'utf8');

function d1(db) {
  const wrap = (sql, params) => ({
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...params) }; },
  });
  return { prepare(sql) { return { bind: (...p) => wrap(sql, p), ...wrap(sql, []) }; } };
}

function request(url, body, ip = '203.0.113.9') {
  const h = { 'cf-connecting-ip': ip, 'content-type': 'application/json' };
  return { url, method: 'POST', headers: { get: (n) => h[n.toLowerCase()] ?? null }, async json() { return body; } };
}

let raw;
let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_5);
  raw.exec("INSERT INTO caregiver (id, first_name, last_name, email, source) VALUES ('cg1','Jane','Doe','Jane.Doe@Example.com','seed')");
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
});
afterEach(() => { globalThis.fetch = realFetch; });

const PROD = () => ({ LEGACY_DB: d1(raw), PORTAL_TOKEN_SECRET: 's', EMAIL_API_KEY: 're_test_key' });

test('canSendEmail: production with a key only; never preview or development; never without a key', () => {
  assert.equal(canSendEmail({ EMAIL_API_KEY: 'k' }), true);
  assert.equal(canSendEmail({ EMAIL_API_KEY: 'k', ENVIRONMENT: 'preview' }), false);
  assert.equal(canSendEmail({ EMAIL_API_KEY: 'k', ENVIRONMENT: 'development' }), false);
  assert.equal(canSendEmail({}), false);
});

test('production: a member gets one email with an absolute, single-use link from no-reply@caregiversanctuary.org', async () => {
  const res = await postPortal({ request: request('https://caregiversanctuary.org/api/portal/login', { email: 'jane.doe@example.com' }), env: PROD() });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, EMAIL_FROM);
  assert.equal(body.reply_to, EMAIL_REPLY_TO);
  assert.deepEqual(body.to, ['Jane.Doe@Example.com']);
  assert.match(body.text, /https:\/\/caregiversanctuary\.org\/api\/portal\/verify\?token=[A-Za-z0-9_-]{43}/);
  assert.doesNotMatch(body.text, /cg1/, 'no caregiver id in the link');
  assert.equal(calls[0].init.headers.authorization, 'Bearer re_test_key');
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.link_emailed'").get().n, 1);
});

test('production: a non-member gets the same response and no email', async () => {
  const res = await postPortal({ request: request('https://caregiversanctuary.org/api/portal/login', { email: 'stranger@example.com' }), env: PROD() });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 0);
});

test('staging never sends, even if a key were present', async () => {
  const env = { ...PROD(), ENVIRONMENT: 'preview', PORTAL_DEV_RETURN_LINK: '1' };
  const res = await postPortal({ request: request('https://staging.caregiversanctuary.org/api/portal/login', { email: 'jane.doe@example.com' }), env });
  const data = await res.json();
  assert.ok(data.dev_link, 'staging keeps the on-screen link');
  assert.equal(calls.length, 0);
});

test('a failed send is audited, and the caregiver still sees the generic response', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const res = await postPortal({ request: request('https://caregiversanctuary.org/api/portal/login', { email: 'jane.doe@example.com' }), env: PROD() });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portal.link_email_failed'").get().n, 1);
});

test('sendEmail never throws, and the HTML link is escaped', async () => {
  const r = await sendEmail({ EMAIL_API_KEY: 'k' }, { to: 'a@b.c', subject: 's', text: 't', html: 'h' }, async () => { throw new Error('network'); });
  assert.deepEqual(r, { ok: false, status: -1 });
  assert.match(signInEmail('https://x.test/?a="b"&c').html, /href="https:\/\/x\.test\/\?a=&quot;b&quot;&amp;c"/);
});

test('a key stored with surrounding whitespace or a newline still works; a blank key counts as none', async () => {
  const seen = [];
  await sendEmail({ EMAIL_API_KEY: 're_abc
' }, { to: 'a@b.c', subject: 's', text: 't', html: 'h' }, async (u, init) => { seen.push(init.headers.authorization); return { ok: true, status: 200 }; });
  assert.deepEqual(seen, ['Bearer re_abc']);
  assert.equal(canSendEmail({ EMAIL_API_KEY: '  
' }), false);
});
