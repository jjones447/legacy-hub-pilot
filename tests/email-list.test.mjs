// Email list phase 1 (issue #301, schema/0020): public sign-up through /api/intake
// (kind 'newsletter'), unsubscribe by token, staff Subscribers list/search/counts/CSV,
// home page section and unsubscribe page markup, staff panel wiring.
// Inert: real schema over node:sqlite, fake requests, vm-stubbed browser. No network, no
// email, no hosted database. All addresses are fictional (example.invalid).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { handleIntake, validateIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postIntake } from '../functions/api/intake.js';
import { onRequestPost as postUnsubscribe } from '../functions/api/unsubscribe.js';
import { onRequestGet as getStaff } from '../functions/api/staff/[[path]].js';
import { onRequest as middleware } from '../functions/_middleware.js';
import {
  NEWSLETTER_CONSENT_TEXT, csvCell, subscribersCsv, isUnsubscribeToken, newUnsubscribeToken,
} from '../functions/_lib/newsletter.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SCHEMA_1 = read('schema/0001_init.sql');
const SCHEMA_20 = read('schema/0020_email_subscriber.sql');

function d1(db) {
  const wrap = (sql, params) => ({
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...params) }; },
  });
  return {
    batchCalls: 0,
    prepare(sql) { return { bind: (...p) => wrap(sql, p), ...wrap(sql, []) }; },
    // D1 runs each batch atomically and one at a time; concurrent callers queue here.
    queue: Promise.resolve(),
    batch(statements) {
      this.batchCalls++;
      const run = async () => {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          db.exec('COMMIT');
          return results;
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      };
      const result = this.queue.then(run, run);
      this.queue = result.catch(() => {});
      return result;
    },
  };
}

function request(url, { method = 'GET', body, headers = {} } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url, method,
    headers: { get: (n) => h[n.toLowerCase()] ?? null },
    async json() { if (body === undefined) throw new Error('no body'); return body; },
  };
}

let raw;
let db;
let ipSerial = 0;
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_20);
  db = d1(raw);
});

const signup = (overrides = {}) => ({
  kind: 'newsletter', source: 'site_form:newsletter', external_ref: 'ref-' + Math.random().toString(16).slice(2),
  email: 'fictional.reader@example.invalid', first_name: 'Fictional', ...overrides,
});
const subscribers = () => raw.prepare('SELECT * FROM email_subscriber ORDER BY created_at, id').all();
const count = (table) => raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
// A fresh client address per call keeps the IP limiter out of tests that are not about it.
const publicPost = (handler, url, body, ip = `192.0.2.${++ipSerial % 250}`) =>
  handler({ request: request(url, { method: 'POST', body, headers: { 'CF-Connecting-IP': ip } }), env: { LEGACY_DB: db } });

test('migration 0020 creates email_subscriber with the documented constraints', () => {
  const cols = Object.fromEntries(raw.prepare('PRAGMA table_info(email_subscriber)').all().map((c) => [c.name, c]));
  for (const name of ['id', 'email', 'first_name', 'status', 'source', 'external_ref', 'consent_text', 'unsubscribe_token', 'created_at', 'updated_at', 'unsubscribed_at']) {
    assert.ok(cols[name], `column ${name}`);
  }
  assert.equal(cols.id.pk, 1);
  assert.equal(cols.email.notnull, 1);
  assert.equal(cols.unsubscribe_token.notnull, 1);
  assert.equal(cols.first_name.notnull, 0);
  assert.equal(cols.unsubscribed_at.notnull, 0);
  const insert = raw.prepare(`INSERT INTO email_subscriber (id, email, unsubscribe_token, source, external_ref) VALUES (?, ?, ?, ?, ?)`);
  insert.run('sub_1', 'a@example.invalid', 'a'.repeat(32), 's', 'r1');
  assert.equal(raw.prepare(`SELECT status FROM email_subscriber WHERE id = 'sub_1'`).get().status, 'subscribed');
  assert.throws(() => insert.run('sub_2', 'a@example.invalid', 'b'.repeat(32), 's', 'r2'), /UNIQUE/);
  assert.throws(() => insert.run('sub_3', 'c@example.invalid', 'a'.repeat(32), 's', 'r3'), /UNIQUE/);
  assert.throws(() => insert.run('sub_4', 'd@example.invalid', 'd'.repeat(32), 's', 'r1'), /UNIQUE/);
  assert.throws(() => raw.exec(`UPDATE email_subscriber SET status = 'bounced' WHERE id = 'sub_1'`), /CHECK/);
  // Re-applying the migration is harmless.
  raw.exec(SCHEMA_20);
});

test('validation: email required and well-formed; first name optional; external_ref required', () => {
  assert.match(validateIntake({ kind: 'newsletter', external_ref: 'x' }), /email is required/);
  assert.match(validateIntake({ kind: 'newsletter', email: 'not-an-email', external_ref: 'x' }), /email is not valid/);
  assert.match(validateIntake({ kind: 'newsletter', email: 'a@example.invalid' }), /external_ref is required/);
  assert.match(validateIntake({ kind: 'newsletter', email: 'a@example.invalid', external_ref: 'x', first_name: 7 }), /first_name/);
  assert.match(validateIntake({ kind: 'newsletter', email: 'a@example.invalid', external_ref: 'x', first_name: 'x'.repeat(101) }), /too long/);
  assert.match(validateIntake({ kind: 'newsletter', email: `${'x'.repeat(250)}@example.invalid`, external_ref: 'x' }), /not valid/);
  assert.equal(validateIntake({ kind: 'newsletter', email: 'a@example.invalid', external_ref: 'x' }), null);
  assert.equal(validateIntake({ kind: 'newsletter', email: ' A@Example.Invalid ', external_ref: 'x', first_name: '' }), null);
});

test('sign-up stores normalized email, consent line and a 128-bit token; no caregiver, followup or token in output', async () => {
  const res = await publicPost(postIntake, 'https://site.example/api/intake', signup({ email: '  Fictional.Reader@Example.INVALID ', first_name: '  Ada  ' }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { ok: true });
  const [row] = subscribers();
  assert.equal(row.email, 'fictional.reader@example.invalid');
  assert.equal(row.first_name, 'Ada');
  assert.equal(row.status, 'subscribed');
  assert.equal(row.source, 'site_form:newsletter');
  assert.equal(row.consent_text, NEWSLETTER_CONSENT_TEXT);
  assert.match(row.id, /^sub_[0-9a-f-]{36}$/);
  assert.ok(isUnsubscribeToken(row.unsubscribe_token));
  assert.equal(row.unsubscribed_at, null);
  assert.equal(text.includes(row.unsubscribe_token), false);
  assert.equal(count('caregiver'), 0, 'newsletter sign-up never creates a caregiver');
  assert.equal(count('followup'), 0);
  const audit = raw.prepare(`SELECT actor, action, entity, entity_id, after_json FROM audit_log WHERE entity = 'email_subscriber'`).all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'newsletter.subscribe');
  assert.equal(audit[0].entity_id, row.id);
  assert.equal(audit[0].after_json.includes(row.unsubscribe_token), false);
  assert.equal(audit[0].after_json.includes('example.invalid'), false, 'audit names the id, not the address');
  assert.equal('confirmation_email' in JSON.parse(text), false, 'no email is attempted');
});

test('first name is optional', async () => {
  const res = await handleIntake(db, signup({ first_name: undefined }));
  assert.equal(res.status, 200);
  assert.equal(subscribers()[0].first_name, null);
  await handleIntake(db, signup({ email: 'b@example.invalid', first_name: '   ' }));
  assert.equal(subscribers()[1].first_name, null);
});

test('invalid sign-ups are refused with 400 and write nothing', async () => {
  for (const body of [signup({ email: '' }), signup({ email: 'no-at-sign' }), signup({ external_ref: '' }), signup({ source: '' })]) {
    const res = await handleIntake(db, body);
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  }
  assert.equal(count('email_subscriber'), 0);
  assert.equal(count('audit_log'), 0);
});

test('idempotent on (source, external_ref): a replay reports duplicate and writes nothing more', async () => {
  const body = signup({ external_ref: 'same-session-ref' });
  assert.deepEqual((await handleIntake(db, body)).body, { ok: true });
  const auditBefore = count('audit_log');
  const again = await handleIntake(db, { ...body });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true, duplicate: true });
  assert.equal(count('email_subscriber'), 1);
  assert.equal(count('audit_log'), auditBefore);
});

test('already subscribed address: same ok answer, no second row, nothing overwritten', async () => {
  await handleIntake(db, signup({ first_name: 'Original' }));
  const before = subscribers()[0];
  const res = await handleIntake(db, signup({ email: 'FICTIONAL.reader@example.invalid', first_name: 'Someone Else' }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true }, 'indistinguishable from a new sign-up (no enumeration)');
  const rows = subscribers();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], before);
});

test('unsubscribe by token, idempotent; unknown token gets the same generic answer', async () => {
  await handleIntake(db, signup());
  const { unsubscribe_token: token, id } = subscribers()[0];

  const unknown = await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token: newUnsubscribeToken() });
  const unknownText = await unknown.text();
  assert.equal(unknown.status, 200);
  assert.equal(subscribers()[0].status, 'subscribed');

  const first = await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token });
  const firstText = await first.text();
  assert.equal(first.status, 200);
  assert.equal(firstText, unknownText, 'known and unknown tokens are indistinguishable');
  assert.deepEqual(JSON.parse(firstText), { ok: true });
  assert.equal(firstText.includes(token), false);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const row = subscribers()[0];
  assert.equal(row.status, 'unsubscribed');
  assert.ok(row.unsubscribed_at);

  const changeRows = () => raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity != 'request_limit'`).get().n;
  const auditCount = changeRows();
  const second = await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token });
  assert.equal(await second.text(), unknownText);
  assert.equal(subscribers()[0].unsubscribed_at, row.unsubscribed_at, 'repeat changes nothing');
  assert.equal(changeRows(), auditCount, 'repeat writes no new change audit');

  const audit = raw.prepare(`SELECT actor, entity_id, before_json, after_json FROM audit_log WHERE action = 'newsletter.unsubscribe'`).all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity_id, id);
  assert.equal(JSON.stringify(audit).includes(token), false, 'token never reaches the audit log');
});

test('unsubscribe refuses malformed tokens and bad JSON without a lookup', async () => {
  for (const token of [undefined, '', 'abc', 'G'.repeat(32), 'A'.repeat(32), 'a'.repeat(33), 12345]) {
    const res = await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: 'invalid_request' });
  }
  const bad = await postUnsubscribe({ request: { url: 'https://site.example/api/unsubscribe', headers: { get: () => '198.51.100.9' }, json: async () => { throw new SyntaxError('bad'); } }, env: { LEGACY_DB: db } });
  assert.equal(bad.status, 400);
});

test('unsubscribe is rate limited per client address', async () => {
  let last;
  for (let i = 0; i < 21; i++) last = await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token: newUnsubscribeToken() }, '203.0.113.77');
  assert.equal(last.status, 429);
});

test('an anonymous sign-up never undoes an unsubscribe or overwrites the row (review P1)', async () => {
  await handleIntake(db, signup({ first_name: 'Before', external_ref: 'first-session' }));
  const original = subscribers()[0];
  await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token: original.unsubscribe_token });
  const withdrawn = subscribers()[0];
  assert.equal(withdrawn.status, 'unsubscribed');
  const audits = count('audit_log');

  // A stranger who only knows the address, with a fresh retry key and a different name.
  const res = await handleIntake(db, signup({ external_ref: 'stranger-session', first_name: 'Stranger' }));
  const fresh = await handleIntake(db, signup({ email: 'someone.new@example.invalid', external_ref: 'new-person' }));
  assert.deepEqual(res.body, fresh.body, 'same generic answer as a brand-new sign-up');
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(subscribers().find((r) => r.id === original.id), withdrawn, 'withdrawal, name, provenance and consent all preserved');
  assert.equal(count('audit_log'), audits + 1, 'only the brand-new sign-up is audited');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'newsletter.resubscribe'`).get().n, 0);
  assert.equal(subscribers().filter((r) => r.email === 'fictional.reader@example.invalid').length, 1);
});

test('concurrent unsubscribes that both read "subscribed" change the row once and write ONE audit (review P2)', async () => {
  await handleIntake(db, signup());
  const { unsubscribe_token: token, id } = subscribers()[0];
  // Hold both requests at their pre-read until both have read 'subscribed', so the race is real.
  let arrived = 0, release;
  const gate = new Promise((r) => { release = r; });
  const gated = {
    ...db,
    batch: (statements) => db.batch(statements),
    prepare(sql) {
      const stmt = db.prepare(sql);
      if (!/SELECT id, status FROM email_subscriber WHERE unsubscribe_token/.test(sql)) return stmt;
      return { bind: (...p) => { const b = stmt.bind(...p); return { ...b, async first() { const row = await b.first(); if (++arrived === 2) release(); await gate; return row; } }; } };
    },
  };
  const { handleUnsubscribe } = await import('../functions/_lib/newsletter.mjs');
  const [a, b] = await Promise.all([handleUnsubscribe(gated, { token }), handleUnsubscribe(gated, { token })]);
  assert.equal(arrived, 2, 'both requests read the row before either wrote');
  assert.deepEqual(a.body, { ok: true });
  assert.deepEqual(b.body, { ok: true });
  assert.equal(subscribers()[0].status, 'unsubscribed');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'newsletter.unsubscribe' AND entity_id = ?`).get(id).n, 1);
});

test('newsletter sign-ups share the public intake IP limit', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await publicPost(postIntake, 'https://site.example/api/intake', signup({ email: `n${i}@example.invalid` }), '203.0.113.5');
  }
  assert.equal(last.status, 429);
  assert.equal(count('email_subscriber'), 10);
});

async function seedList() {
  const people = [
    ['ada@example.invalid', 'Ada'], ['grace@example.invalid', 'Grace'], ['=cmd@example.invalid', '=HYPERLINK("x")'],
    ['plus@example.invalid', '+SUM(1)'], ['quote@example.invalid', 'Quote "Q" Person'], ['left@example.invalid', 'Leaver'],
    ['under_score@example.invalid', null],
  ];
  for (const [email, first_name] of people) await handleIntake(db, signup({ email, first_name: first_name ?? undefined }));
  const leaver = raw.prepare(`SELECT unsubscribe_token FROM email_subscriber WHERE email = 'left@example.invalid'`).get();
  await publicPost(postUnsubscribe, 'https://site.example/api/unsubscribe', { token: leaver.unsubscribe_token });
}

const staffGet = (path) => getStaff({ request: request('https://site.example' + path, { headers: { 'Cf-Access-Jwt-Assertion': '' } }), env: { LEGACY_DB: db } });

test('staff list returns rows, whole-list counts and never exposes tokens', async () => {
  await seedList();
  const res = await staffGet('/api/staff/subscribers');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  const data = JSON.parse(text);
  assert.equal(data.ok, true);
  assert.deepEqual(data.counts, { subscribed: 6, unsubscribed: 1, total: 7 });
  assert.equal(data.subscribers.length, 7);
  assert.equal(data.matching, 7);
  for (const row of data.subscribers) assert.equal('unsubscribe_token' in row, false);
  for (const { unsubscribe_token } of subscribers()) assert.equal(text.includes(unsubscribe_token), false);
});

test('staff search filters by email or first name (case-insensitive, LIKE wildcards literal) and by status', async () => {
  await seedList();
  const q = async (qs) => (await (await staffGet('/api/staff/subscribers?' + qs)).json());
  assert.deepEqual((await q('q=GRACE')).subscribers.map((r) => r.email), ['grace@example.invalid']);
  assert.deepEqual((await q('q=ada')).subscribers.map((r) => r.first_name), ['Ada']);
  assert.deepEqual((await q('q=_')).subscribers.map((r) => r.email), ['under_score@example.invalid'], '_ is literal');
  assert.equal((await q('q=%25')).subscribers.length, 0, '% is literal');
  const left = await q('status=unsubscribed');
  assert.deepEqual(left.subscribers.map((r) => r.email), ['left@example.invalid']);
  assert.equal(left.matching, 1);
  assert.deepEqual(left.counts, { subscribed: 6, unsubscribed: 1, total: 7 }, 'counts cover the whole list');
  assert.equal((await q('q=nobody-here')).subscribers.length, 0);
});

test('staff CSV exports subscribed addresses only, quoted, with formula injection neutralized and audited', async () => {
  await seedList();
  for (const path of ['/api/staff/subscribers.csv', '/api/staff/subscribers?format=csv']) {
    const res = await staffGet(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="legacy-email-subscribers-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const csv = (await res.text()).replace(/^﻿/, '');
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines[0], '"email","first_name","status","source","created_at","updated_at"');
    assert.equal(lines.length, 7, 'header + six subscribed rows');
    assert.equal(csv.includes('left@example.invalid'), false, 'unsubscribed addresses are not exported');
    assert.ok(lines.some((l) => l.startsWith(`"'=cmd@example.invalid","'=HYPERLINK(""x"")"`)));
    assert.ok(lines.some((l) => l.startsWith(`"plus@example.invalid","'+SUM(1)"`)));
    assert.ok(lines.some((l) => l.startsWith(`"quote@example.invalid","Quote ""Q"" Person"`)));
    for (const { unsubscribe_token } of subscribers()) assert.equal(csv.includes(unsubscribe_token), false);
  }
  const audits = raw.prepare(`SELECT actor, after_json FROM audit_log WHERE action = 'subscriber.export'`).all();
  assert.equal(audits.length, 2);
  assert.deepEqual(JSON.parse(audits[0].after_json), { rows: 6 });
});

test('csvCell guards every formula prefix and escapes quotes, commas and newlines', () => {
  assert.equal(csvCell('=1+1'), `"'=1+1"`);
  assert.equal(csvCell('+1'), `"'+1"`);
  assert.equal(csvCell('-1'), `"'-1"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('\tTab'), `"'\tTab"`);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('safe-name'), '"safe-name"', 'only a leading character triggers the guard');
  assert.equal(subscribersCsv([]), '"email","first_name","status","source","created_at","updated_at"\r\n');
});

test('subscriber routes are behind the staff Access guard; the public endpoints are not', async () => {
  const status = async (path, method = 'GET') => (await middleware({
    request: new Request('https://legacy-hub.pages.dev' + path, { method }),
    next: async () => new Response('handler', { status: 200 }),
    env: {},
  })).status;
  assert.equal(await status('/api/staff/subscribers'), 403);
  assert.equal(await status('/api/staff/subscribers.csv'), 403);
  assert.equal(await status('/api/staff/subscribers?format=csv'), 403);
  assert.equal(await status('/api/unsubscribe', 'POST'), 200);
  assert.equal(await status('/unsubscribe'), 200);
});

test('unsubscribe tokens are 32 lowercase hex characters and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const token = newUnsubscribeToken();
    assert.ok(isUnsubscribeToken(token));
    seen.add(token);
  }
  assert.equal(seen.size, 200);
});

// ---------- Markup ----------

test('home page email list section: labels, required email, consent line, live status regions', () => {
  for (const path of ['index.html', 'templates/index.html.j2']) {
    const html = read(path);
    const section = html.match(/<section class="home-email-list" id="email-list" aria-labelledby="emailListHeading">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(section, `${path}: email list section`);
    assert.match(section, /<h2 id="emailListHeading"[^>]*>Join our email list<\/h2>/);
    assert.match(section, /<form id="emailListForm" data-action="submit-email-list" method="post" action="#email-list">/);
    assert.match(section, /<label for="emailListFirstName">First name <span class="muted small">\(optional\)<\/span><\/label>/);
    assert.match(section, /<input id="emailListFirstName" type="text" autocomplete="given-name"/);
    assert.doesNotMatch(section.match(/<input id="emailListFirstName"[^>]*>/)[0], /required/);
    assert.match(section, /<label for="emailListEmail">Email address<\/label>/);
    assert.match(section, /<input id="emailListEmail" type="email" autocomplete="email" maxlength="254" required aria-required="true">/);
    assert.ok(section.includes(`<p class="privacy-line" id="emailListConsent">${NEWSLETTER_CONSENT_TEXT}</p>`), 'shown consent line is exactly the stored consent text');
    assert.match(section, /<button type="submit" class="btn btn-coral w-100" aria-describedby="emailListConsent" disabled>Join the email list<\/button>/);
    assert.match(section, /<p data-email-list-pending role="status" aria-live="polite" hidden>/);
    assert.match(section, /class="success-note" data-intake-success role="status" aria-live="polite" tabindex="-1"/);
    assert.match(section, /class="error-note" data-intake-error role="alert" aria-live="assertive" tabindex="-1"/);
  }
  assert.match(read('styles.css'), /\.email-list-card \{[^}]*max-width: 520px/);
  assert.match(read('styles.css'), /@media \(max-width: 600px\) \{ \.email-list-card \{ padding: 22px 18px; \} \}/);
});

test('without the script, a native submission can carry no personal data and cannot use GET (review P3)', () => {
  for (const path of ['index.html', 'templates/index.html.j2']) {
    const html = read(path);
    const form = html.match(/<form id="emailListForm"[^>]*>([\s\S]*?)<\/form>/);
    assert.ok(form, `${path}: form`);
    const open = form[0].match(/<form[^>]*>/)[0];
    // HTML: a missing/invalid method is GET; the form data set holds only NAMED controls.
    assert.match(open, /\smethod="post"/i, `${path}: explicit POST, never a URL query`);
    const controls = [...form[1].matchAll(/<(input|select|textarea|button)\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(controls.length >= 3);
    assert.deepEqual(controls.filter((c) => /\sname=/.test(c)), [], `${path}: no named control, so nothing personal is submitted natively`);
    assert.match(form[1], /<button type="submit"[^>]*\sdisabled>/, `${path}: submit disabled until the script is ready`);
    assert.match(form[1], /<p class="small muted" data-email-list-not-ready>[^<]*JavaScript[\s\S]*?<\/p>/, `${path}: understandable not-ready message`);
  }
});

test('the script enables the sign-up only when it runs, and hides the not-ready note', () => {
  const b = browser({ extraRegions: ['[data-email-list-not-ready]'] });
  b.regions['[type="submit"]'].disabled = true;
  b.regions['[data-email-list-not-ready]'].hidden = false;
  b.context.initEmailListForm();
  assert.equal(b.regions['[type="submit"]'].disabled, false);
  assert.equal(b.regions['[data-email-list-not-ready]'].hidden, true);
  assert.match(app, /initUnsubscribePage\(window\.location, window\.history\);\n  initEmailListForm\(\);/, "wired at DOMContentLoaded");
});

test('outcome copy never claims a subscription the server may have refused (review 5730619796 P2)', () => {
  for (const [path, unsub] of [['index.html', 'unsubscribe.html'], ['templates/index.html.j2', 'templates/unsubscribe.html.j2']]) {
    const success = read(path).match(/<form id="emailListForm"[\s\S]*?<div class="success-note" data-intake-success[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(success, `${path}: sign-up success note`);
    // Valid for a new address, one already on the list, and one that previously unsubscribed.
    assert.match(success, /^Thank you\. We've received your request to join the Legacy email list\./);
    assert.doesNotMatch(success, /on the list|(?<!un)subscribed|you're in|welcome to/i);
    assert.match(success, /previously unsubscribed[\s\S]*<a href="about\.html#contact">contact Legacy<\/a>/);
    const done = read(unsub).match(/<div class="success-note" data-intake-success[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(done, `${unsub}: unsubscribe outcome`);
    assert.doesNotMatch(done, /home page|join again|sign up again/i, 'no self-service rejoin is promised');
    assert.match(done, /<a href="about\.html#contact">contact Legacy<\/a>/);
  }
});

test('unsubscribe page has public chrome, noindex, a labelled form and generic outcome copy', () => {
  const html = read('unsubscribe.html');
  assert.ok(html.includes('<a class="skip-link" href="#main">Skip to content</a>'));
  assert.ok(html.includes('<main id="main">'));
  assert.ok(html.includes('class="crisis-bar"'));
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="description" content="Leave the Legacy Home &amp; Respite Care Foundation email list\.">|<meta name="description" content="Leave the Legacy Home & Respite Care Foundation email list\.">/);
  assert.match(html, /<form id="unsubscribeForm" data-action="submit-unsubscribe">/);
  assert.match(html, /<h1 id="unsubscribeHeading"[^>]*>Unsubscribe<\/h1>/);
  assert.match(html, /data-unsubscribe-pending role="status" aria-live="polite" hidden/);
  assert.match(html, /data-intake-success role="status"[^>]*>If this link matches a subscription, it is now unsubscribed\./);
  assert.match(html, /data-intake-error role="alert"/);
  assert.match(html, /<script src="app\.js\?v=[0-9a-f]{12}"><\/script>/);
  // Other pages carry no robots meta; only the unsubscribe page opts out of indexing.
  assert.doesNotMatch(read('index.html'), /name="robots"/);
});

// ---------- Browser behavior (vm stubs) ----------

const app = read('app.js');
const appSource = app.slice(0, app.indexOf('/* ---------- Resource hub:'));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function region() {
  return { style: { display: 'none' }, hidden: true, disabled: false, textContent: '', focusCount: 0, focus() { this.focusCount++; } };
}

function browser({ fetchImpl, inputs = {}, formId = 'emailListForm', extraRegions = [] } = {}) {
  const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]',
    '[data-email-list-pending]', '[data-unsubscribe-pending]', '[data-unsubscribe-ready]', '[data-unsubscribe-missing]', ...extraRegions]
    .map((key) => [key, region()]));
  regions['[data-intake-routing]'] = null;
  const form = { id: formId, querySelector: (key) => regions[key] ?? null };
  const fields = { emailListEmail: { value: 'fictional.reader@example.invalid' }, emailListFirstName: { value: ' Ada ' }, ...inputs };
  const store = new Map(), calls = [];
  const context = {
    document: { getElementById: (id) => (id === formId ? form : fields[id] ?? null) },
    crypto: { randomUUID: () => 'fictional-email-list-ref' },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    URLSearchParams,
    setTimeout, clearTimeout,
    fetch(url, options) { calls.push({ url, payload: JSON.parse(options.body) }); return fetchImpl?.(url, options) ?? Promise.resolve(response(200, { ok: true })); },
  };
  vm.runInNewContext(appSource, context);
  return { context, form, regions, calls, fields };
}

test('email list form posts a newsletter intake once, shows pending then success, and focuses the result', async () => {
  const b = browser();
  b.context.submitEmailList({ preventDefault() {} });
  assert.equal(b.regions['[data-email-list-pending]'].hidden, false);
  assert.equal(b.form.ariaBusy, 'true');
  assert.equal(b.regions['[type="submit"]'].disabled, true);
  await settle();
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].url, '/api/intake');
  assert.deepEqual(b.calls[0].payload, {
    kind: 'newsletter', source: 'site_form:newsletter', external_ref: 'fictional-email-list-ref',
    first_name: 'Ada', email: 'fictional.reader@example.invalid',
  });
  assert.equal(b.regions['[data-email-list-pending]'].hidden, true);
  assert.equal(b.regions['[data-intake-success]'].style.display, 'block');
  assert.equal(b.regions['[data-intake-success]'].focusCount, 1);
  assert.equal(b.form.ariaBusy, 'false');
  b.context.submitEmailList({ preventDefault() {} });
  await settle();
  assert.equal(b.calls.length, 1, 'a saved sign-up is not sent again');
});

test('email list form: empty email is refused locally; server refusal shows an alert and allows a same-key retry', async () => {
  const empty = browser({ inputs: { emailListEmail: { value: '   ' } } });
  empty.context.submitEmailList({ preventDefault() {} });
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.regions['[data-intake-error]'].style.display, 'block');
  assert.match(empty.regions['[data-intake-error]'].textContent, /enter your email/);

  let attempt = 0;
  const b = browser({ fetchImpl: async () => (++attempt === 1 ? response(503, { ok: false }) : response(200, { ok: true })) });
  b.context.submitEmailList({ preventDefault() {} });
  await settle();
  assert.equal(b.regions['[data-intake-error]'].style.display, 'block');
  assert.equal(b.regions['[data-intake-error]'].focusCount, 1);
  assert.equal(b.regions['[type="submit"]'].disabled, false);
  b.context.submitEmailList({ preventDefault() {} });
  await settle();
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls[1].payload.external_ref, b.calls[0].payload.external_ref, 'retry reuses the idempotency key');
  assert.equal(b.regions['[data-intake-success]'].style.display, 'block');
});

test('unsubscribe page strips the token from the address bar and posts it only on submit', async () => {
  const token = 'ab'.repeat(16);
  const b = browser({ formId: 'unsubscribeForm' });
  const replaced = [];
  b.context.initUnsubscribePage({ search: `?token=${token}`, pathname: '/unsubscribe' }, { replaceState: (...args) => replaced.push(args) });
  assert.deepEqual(replaced, [[null, '', '/unsubscribe']]);
  assert.equal(b.calls.length, 0, 'opening the link sends nothing');
  assert.equal(b.regions['[data-unsubscribe-ready]'].hidden, false);
  assert.equal(b.regions['[data-unsubscribe-missing]'].hidden, true);
  assert.equal(b.regions['[type="submit"]'].disabled, false);
  b.context.submitUnsubscribe({ preventDefault() {} });
  assert.equal(b.regions['[data-unsubscribe-pending]'].hidden, false);
  await settle(); await settle();
  assert.deepEqual(b.calls, [{ url: '/api/unsubscribe', payload: { token } }]);
  assert.equal(b.regions['[data-intake-success]'].style.display, 'block');
  assert.equal(b.regions['[data-unsubscribe-pending]'].hidden, true);
  assert.equal(b.regions['[type="submit"]'].disabled, true);
});

test('unsubscribe page without a valid token explains and cannot submit', () => {
  for (const search of ['', '?token=', '?token=not-a-token']) {
    const b = browser({ formId: 'unsubscribeForm' });
    b.context.initUnsubscribePage({ search, pathname: '/unsubscribe' }, { replaceState() {} });
    assert.equal(b.regions['[data-unsubscribe-missing]'].hidden, false);
    assert.equal(b.regions['[data-unsubscribe-ready]'].hidden, true);
    assert.equal(b.regions['[type="submit"]'].disabled, true);
    b.context.submitUnsubscribe({ preventDefault() {} });
    assert.equal(b.calls.length, 0);
  }
});

test('app.js wires both forms through the shared submit dispatcher', () => {
  assert.match(app, /action === 'submit-email-list'\) \{\s*e\.preventDefault\(\);\s*submitEmailList\(e\);/);
  assert.match(app, /action === 'submit-unsubscribe'\) \{\s*e\.preventDefault\(\);\s*submitUnsubscribe\(e\);/);
  assert.match(app, /initUnsubscribePage\(window\.location, window\.history\)/);
});

// ---------- Staff panel ----------

test('staff console has a read-only Subscribers panel with search, counts and CSV download', () => {
  const html = read('staff.html');
  const panel = html.match(/<div class="panel" id="subscribersPanel"[^>]*>([\s\S]*?)<\/table>/)?.[1];
  assert.ok(panel, 'subscribers panel');
  assert.match(panel, /<h4 class="m-0" id="subscribersHeading">Subscribers<\/h4>/);
  assert.match(panel, /<a class="btn btn-sm btn-outline" id="subscribersCsvLink" href="\/api\/staff\/subscribers\.csv" download>Download CSV<\/a>/);
  assert.match(panel, /id="subscribersCounts" role="status" aria-live="polite"/);
  assert.match(panel, /<input type="search" id="subscribersSearchQuery"[^>]*aria-label="Search subscribers">/);
  assert.match(panel, /id="subscribersStatusFilter"/);
  assert.match(panel, /<button type="button" class="btn btn-sm btn-plum" id="subscribersSearchBtn">Search subscribers<\/button>/);
  assert.match(panel, /<tbody id="subscribersTableBody">/);
  assert.match(panel, /nothing here sends email/);
  assert.ok(html.indexOf('id="subscribersPanel"') < html.indexOf('id="recentChangesPanel"'), 'Change log and Site content stay last');
  const staff = read('staff.js');
  assert.match(staff, /loadWellnessCaregivers\(\),\s*loadSubscribers\(\)\s*\]\);/);
  assert.match(staff, /getElementById\('subscribersSearchBtn'\)\?\.addEventListener\('click'/);
});

test('staff Subscribers panel renders escaped rows and counts from the API', async () => {
  const staff = read('staff.js');
  const start = staff.indexOf('let subscribersEpoch = 0;');
  const end = staff.indexOf('async function loadGrants()');
  const els = {
    subscribersTableBody: { innerHTML: '' }, subscribersCounts: { textContent: '' },
    subscribersSearchQuery: { value: ' ada ' }, subscribersStatusFilter: { value: 'subscribed' },
  };
  const urls = [];
  const context = {
    document: { getElementById: (id) => els[id] ?? null },
    URLSearchParams,
    fetch: async (url) => { urls.push(url); return response(200, { ok: true, matching: 1, counts: { subscribed: 3, unsubscribed: 2, total: 5 },
      subscribers: [{ email: 'x<script>@example.invalid', first_name: '<b>Ada</b>', status: 'subscribed', created_at: '2026-10-31 12:00:00' }] }); },
  };
  // escapeHtml (top of staff.js) + the subscriber functions only.
  vm.runInNewContext(staff.slice(0, staff.indexOf('// datetime-local')) + staff.slice(start, end), context);
  await context.loadSubscribers();
  assert.deepEqual(urls, ['/api/staff/subscribers?q=ada&status=subscribed']);
  assert.equal(els.subscribersCounts.textContent, '3 subscribed · 2 unsubscribed · 1 matching');
  assert.match(els.subscribersTableBody.innerHTML, /x&lt;script&gt;@example\.invalid/);
  assert.match(els.subscribersTableBody.innerHTML, /&lt;b&gt;Ada&lt;\/b&gt;/);
  assert.match(els.subscribersTableBody.innerHTML, /2026-10-31/);
  assert.doesNotMatch(els.subscribersTableBody.innerHTML, /<script>|<b>/);
});

// ---- Internal QA accounts stay out of the staff view and export (Legacy54 c6660164573).
function caregiver(id, email, { source = 'site_form', tags = '[]', status = 'active' } = {}) {
  raw.prepare(`INSERT INTO caregiver (id, first_name, email, source, segment_tags, status) VALUES (?, 'Fictional', ?, ?, ?, ?)`)
    .run(id, email, source, tags, status);
}
async function seedInternalMix() {
  // Fictional internal accounts: one by qa_ source, one by tag; mixed case and spaces in caregiver.email.
  caregiver('cg_qa_source', '  QA.Source@Example.Invalid ', { source: 'qa_staging' });
  caregiver('cg_qa_tag', 'qa.tagged@example.invalid', { tags: '["exclude_reporting"]' });
  // Ordinary look-alikes that must stay visible.
  caregiver('cg_qatar', 'qatar.referral@example.invalid', { source: 'qatar_referral' });
  caregiver('cg_xcentric', 'xcentric-test@example.invalid', { source: 'site_form', tags: '["volunteer"]' });
  for (const [email, first_name] of [
    ['qa.source@example.invalid', 'Internal'], ['qa.tagged@example.invalid', 'Internal'],
    ['qatar.referral@example.invalid', 'Ordinary'], ['xcentric-test@example.invalid', 'Ordinary'],
    ['unmatched@example.invalid', 'Ordinary'],
  ]) await handleIntake(db, signup({ email, first_name }));
}

test('internal QA subscribers are hidden from list, counts, search, status filter and CSV; look-alikes stay', async () => {
  await seedInternalMix();
  const list = async (qs = '') => (await (await staffGet('/api/staff/subscribers' + (qs ? '?' + qs : ''))).json());
  const all = await list();
  const shown = all.subscribers.map((r) => r.email).sort();
  assert.deepEqual(shown, ['qatar.referral@example.invalid', 'unmatched@example.invalid', 'xcentric-test@example.invalid']);
  assert.deepEqual(all.counts, { subscribed: 3, unsubscribed: 0, total: 3 });
  assert.equal(all.matching, 3);
  assert.deepEqual((await list('q=qa')).subscribers.map((r) => r.email), ['qatar.referral@example.invalid'], 'search cannot surface internal rows');
  assert.equal((await list('status=subscribed')).matching, 3);
  const csv = (await (await staffGet('/api/staff/subscribers.csv')).text()).replace(/^﻿/, '');
  assert.equal(csv.trimEnd().split('\r\n').length, 4, 'header + three ordinary rows');
  assert.equal(/qa\.source|qa\.tagged/.test(csv), false);
  const audit = raw.prepare(`SELECT after_json FROM audit_log WHERE action = 'subscriber.export'`).all();
  assert.deepEqual(JSON.parse(audit.at(-1).after_json), { rows: 3 }, 'export audit counts what was exported');
});

test('the exclusion is a view only: internal subscriber rows, consent and tokens are untouched', async () => {
  await seedInternalMix();
  await staffGet('/api/staff/subscribers');
  await staffGet('/api/staff/subscribers.csv');
  assert.equal(count('email_subscriber'), 5);
  const internal = raw.prepare(`SELECT status, consent_text, unsubscribe_token FROM email_subscriber WHERE email = 'qa.tagged@example.invalid'`).get();
  assert.equal(internal.status, 'subscribed');
  assert.ok(internal.consent_text && /^[0-9a-f]{32}$/.test(internal.unsubscribe_token));
});

test('without matching internal caregivers nothing is hidden; an archived internal caregiver still hides its address', async () => {
  await seedList();
  assert.deepEqual((await (await staffGet('/api/staff/subscribers')).json()).counts, { subscribed: 6, unsubscribed: 1, total: 7 });
  caregiver('cg_qa_archived', 'ada@example.invalid', { source: 'qa_prod', status: 'archived' });
  const after = await (await staffGet('/api/staff/subscribers')).json();
  assert.deepEqual(after.counts, { subscribed: 5, unsubscribed: 1, total: 6 });
  assert.equal(after.subscribers.some((r) => r.email === 'ada@example.invalid'), false);
});
