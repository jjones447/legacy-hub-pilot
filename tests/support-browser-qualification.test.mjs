import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { SUPPORT_BROWSER_ORIGIN } from '../functions/_lib/support-browser-qualification.mjs';
import { prepareConfirmation } from './helpers/confirmed-portal.mjs';

const id = 'support_browser_fixture';
const mailbox = 'operator@example.org';
const sender = 'sender@example.org';
const secret = 'synthetic isolated signer';

test('only the pinned eligible mailbox can get an ordinary same-origin link and load the Dashboard', async t => {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  for (const path of ['../schema/0001_init.sql', '../schema/0005_portal_login.sql', '../qualification/support-browser/dashboard.sql']) {
    raw.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  assert.equal(raw.prepare('SELECT count(*) AS n FROM caregiver').get().n, 0, 'Dashboard schema is seed-free');
  const insert = raw.prepare('INSERT INTO caregiver(id,first_name,email,source) VALUES(?,?,?,?)');
  insert.run(id, 'Fictional', mailbox, 'support_qualification');
  insert.run('other_fixture', 'Other', 'other@example.org', 'support_qualification');
  let beforeClaim;
  const db = { prepare(sql) { return { bind(...values) { return {
    async first() { return raw.prepare(sql).get(...values) ?? null; },
    async all() { return { results: raw.prepare(sql).all(...values) }; },
    async run() {
      if (sql.startsWith('UPDATE portal_token SET used')) beforeClaim?.();
      return { success: true, meta: raw.prepare(sql).run(...values) };
    },
  }; } }; } };
  const env = {
    ENVIRONMENT: 'preview', SUPPORT_BROWSER_QUALIFICATION: '1', PORTAL_PREVIEW_MAIL_ENABLED: '1',
    PORTAL_SUPPORT_REQUEST_ENABLED: '1', EMAIL_API_KEY: 'synthetic-credential', PORTAL_TOKEN_SECRET: secret, LEGACY_DB: db,
    SUPPORT_BROWSER_QA_OWNER_ID: id, SUPPORT_BROWSER_QA_EMAIL: mailbox, SUPPORT_BROWSER_MAIL_FROM: sender,
    SUPPORT_BROWSER_STAFF_EMAIL: 'staff@example.org',
  };
  const trackedMail = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    trackedMail.push(JSON.parse(options.body));
    return { ok: true, status: 202 };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const login = (email, origin = SUPPORT_BROWSER_ORIGIN, overrides = {}) => onRequestPost({ env: { ...env, ...overrides },
    request: new Request(origin + '/api/portal/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }) }),
  });
  const tokens = () => raw.prepare('SELECT count(*) AS n FROM portal_token').get().n;
  for (const origin of ['https://staging.legacy-hub-5qo.pages.dev', 'http://qa.legacy-support-qualification.pages.dev',
    'https://immutable.legacy-support-qualification.pages.dev']) {
    assert.equal((await login(mailbox, origin)).status, 503);
  }
  for (const overrides of [{ SUPPORT_BROWSER_QUALIFICATION: '0' }, { ENVIRONMENT: 'production' },
    { PORTAL_TEST_INBOX_ENABLED: '1' }, { SUPPORT_BROWSER_QA_EMAIL: 'undeliverable@example.invalid' }]) {
    assert.equal((await login(mailbox, SUPPORT_BROWSER_ORIGIN, overrides)).status, 503);
  }
  assert.deepEqual(await (await login('other@example.org')).json(), { ok: true });
  raw.prepare('UPDATE caregiver SET segment_tags=? WHERE id=?').run('["qa_test"]', id);
  assert.deepEqual(await (await login(mailbox)).json(), { ok: true });
  assert.equal(tokens(), 0);
  assert.equal(trackedMail.length, 0);

  raw.prepare('UPDATE caregiver SET segment_tags=? WHERE id=?').run('[]', id);
  assert.deepEqual(await (await login(mailbox)).json(), { ok: true });
  assert.equal(trackedMail.length, 1);
  assert.deepEqual(trackedMail[0].to, [mailbox]);
  assert.equal(trackedMail[0].from, sender);
  const link = trackedMail[0].text.match(/https:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
  assert.equal(new URL(link).origin, SUPPORT_BROWSER_ORIGIN);
  const form = await prepareConfirmation(link, env);
  const redeemed = await onRequestPost({ env, request: form.request() });
  assert.equal(redeemed.status, 302);
  const cookie = redeemed.headers.get('Set-Cookie').split(';')[0];
  const read = (route, value = cookie) => onRequestGet({ env, request: new Request(SUPPORT_BROWSER_ORIGIN + '/api/portal/' + route,
    { headers: { Cookie: value } }) });
  assert.equal((await read('me')).status, 200, 'Dashboard uses full /me with award table');
  assert.equal((await read('wellness')).status, 200);
  assert.equal((await read('me?support=1')).status, 200);
  const updateTags = raw.prepare('UPDATE caregiver SET segment_tags=? WHERE id=?');
  updateTags.run('["exclude_reporting"]', id);
  assert.equal((await read('me')).status, 401, 'the signed cookie cannot outlive fixture eligibility');
  assert.equal((await read('me?support=1')).status, 401);
  updateTags.run('[]', id);

  assert.equal((await login(mailbox)).status, 200);
  const pendingLink = trackedMail.at(-1).text.match(/https:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
  const ineligibleForm = await prepareConfirmation(pendingLink, env);
  const moveMailbox = raw.prepare('UPDATE caregiver SET email=? WHERE id=?');
  moveMailbox.run('changed@example.org', id);
  const rejected = await onRequestPost({ env, request: ineligibleForm.request() });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.headers.get('Set-Cookie'), null);
  moveMailbox.run(mailbox, id);

  beforeClaim = () => updateTags.run('["qa_test"]', id);
  const raceForm = await prepareConfirmation(pendingLink, env);
  const raced = await onRequestPost({ env, request: raceForm.request() });
  assert.equal(raced.status, 400);
  assert.equal(raced.headers.get('Set-Cookie'), null);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM portal_token WHERE used=0').get().n, 1);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM audit_log WHERE action='portal.login_success'").get().n, 1);
  const otherPayload = `other_fixture:${Date.now() + 60000}`;
  const otherSignature = createHmac('sha256', secret).update(`session:${otherPayload}`).digest('hex');
  const otherCookie = `portal_session=${encodeURIComponent(`${otherPayload}:${otherSignature}`)}`;
  assert.equal((await read('me?support=1', otherCookie)).status, 401);
});
