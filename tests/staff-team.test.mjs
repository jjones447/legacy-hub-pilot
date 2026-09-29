// Staff records (schema 0011): created on first verified sign-in, managed by admins in the console,
// and a deactivated person is refused even while Cloudflare Access still admits them.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { recordStaffSignIn, updateStaffMember, listStaff, LAST_SEEN_REFRESH_MS } from '../functions/_lib/staff.js';
import { staffGate } from '../functions/_middleware.js';
import { onRequestGet as getStaff, onRequestPatch as patchStaff } from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_11 = readFileSync(new URL('../schema/0011_staff_member.sql', import.meta.url), 'utf8');
const STAFF_HTML = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');

function d1(db) {
  const wrap = (sql, params) => ({
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: db.prepare(sql).all(...params) }; },
  });
  return { prepare(sql) { return { bind: (...p) => wrap(sql, p), ...wrap(sql, []) }; } };
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
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_11);
  db = d1(raw);
});

const ADMIN = 'info@legacyhomehealthservices.org';
const T0 = Date.parse('2026-09-29T18:00:00Z');

test('the migration seeds the allow-listed people as active admins', async () => {
  const team = await listStaff(db);
  const admins = team.filter((m) => m.role === 'admin' && m.status === 'active').map((m) => m.email).sort();
  assert.deepEqual(admins, ['info@legacyhomehealthservices.org', 'jacob.jones447@gmail.com', 'jacob.jones@empyreanconsulting.com']);
});

test('first sign-in creates an active staff record (not admin) and an audit row; email is lower-cased', async () => {
  const m = await recordStaffSignIn(db, '  New.Person@LegacyHomeHealthServices.org ', T0);
  assert.equal(m.email, 'new.person@legacyhomehealthservices.org');
  assert.equal(m.role, 'staff');
  assert.equal(m.status, 'active');
  const row = raw.prepare('SELECT role, status, first_seen_at FROM staff_member WHERE email = ?').get(m.email);
  assert.equal(row.role, 'staff');
  assert.equal(row.first_seen_at, '2026-09-29 18:00:00');
  const audit = raw.prepare("SELECT actor FROM audit_log WHERE action = 'staff.first_sign_in'").all();
  assert.equal(audit.length, 1);
});

test('last_seen_at is refreshed only when stale', async () => {
  const email = 'a@legacyhomehealthservices.org';
  await recordStaffSignIn(db, email, T0);
  await recordStaffSignIn(db, email, T0 + 60 * 1000);
  assert.equal(raw.prepare('SELECT last_seen_at FROM staff_member WHERE email = ?').get(email).last_seen_at, '2026-09-29 18:00:00');
  await recordStaffSignIn(db, email, T0 + LAST_SEEN_REFRESH_MS + 1000);
  assert.equal(raw.prepare('SELECT last_seen_at FROM staff_member WHERE email = ?').get(email).last_seen_at, '2026-09-29 18:10:01');
});

test('staffGate refuses a deactivated person and admits an active one', async () => {
  const env = { LEGACY_DB: db };
  assert.equal(await staffGate(env, { email: ADMIN }, T0), null);
  raw.prepare("UPDATE staff_member SET status = 'deactivated' WHERE email = 'jacob.jones447@gmail.com'").run();
  const res = await staffGate(env, { email: 'Jacob.Jones447@gmail.com' }, T0);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'deactivated');
});

test('staffGate never locks staff out on a missing table, a missing database, or a service token', async () => {
  const bare = new DatabaseSync(':memory:');
  bare.exec(SCHEMA_1); // no 0011
  assert.equal(await staffGate({ LEGACY_DB: d1(bare) }, { email: ADMIN }), null);
  assert.equal(await staffGate({}, { email: ADMIN }), null);
  assert.equal(await staffGate({ LEGACY_DB: db }, { common_name: 'svc-token' }), null);
});

test('only an active admin can change staff records', async () => {
  await recordStaffSignIn(db, 'staffer@legacyhomehealthservices.org', T0);
  const r = await updateStaffMember(db, 'staffer@legacyhomehealthservices.org', ADMIN, { display_name: 'x' });
  assert.equal(r.status, 403);
});

test('an admin names, promotes and deactivates someone, each audited with before and after', async () => {
  const who = 'new@legacyhomehealthservices.org';
  await recordStaffSignIn(db, who, T0);
  let r = await updateStaffMember(db, ADMIN, who, { display_name: '  Pat Lee ', role: 'admin' });
  assert.equal(r.ok, true);
  assert.equal(r.member.display_name, 'Pat Lee');
  assert.equal(r.member.role, 'admin');
  r = await updateStaffMember(db, ADMIN, who, { status: 'deactivated' });
  assert.equal(r.ok, true);
  const audits = raw.prepare("SELECT before_json, after_json FROM audit_log WHERE action = 'staff.updated' ORDER BY id").all();
  assert.equal(audits.length, 2);
  assert.equal(JSON.parse(audits[1].before_json).status, 'active');
  assert.equal(JSON.parse(audits[1].after_json).status, 'deactivated');
});

test('nobody changes their own role or status, and the last active admin stays', async () => {
  let r = await updateStaffMember(db, ADMIN, ADMIN, { status: 'deactivated' });
  assert.equal(r.status, 400);
  r = await updateStaffMember(db, ADMIN, ADMIN, { display_name: 'Shanelle S.' });
  assert.equal(r.ok, true, 'renaming yourself is fine');
  raw.prepare("UPDATE staff_member SET status = 'deactivated' WHERE email != ?").run(ADMIN);
  raw.prepare("INSERT INTO staff_member (email, role) VALUES ('second@legacyhomehealthservices.org', 'admin')").run();
  r = await updateStaffMember(db, 'second@legacyhomehealthservices.org', ADMIN, { role: 'staff' });
  assert.equal(r.ok, true, 'another active admin remains');
  r = await updateStaffMember(db, ADMIN, 'second@legacyhomehealthservices.org', { role: 'staff' });
  assert.equal(r.status, 403, 'a demoted admin can no longer change records');
});

test('an admin can demote another admin because the acting admin remains', async () => {
  const r = await updateStaffMember(db, ADMIN, 'jacob.jones447@gmail.com', { role: 'staff' });
  assert.equal(r.ok, true);
  const active = raw.prepare("SELECT COUNT(*) AS n FROM staff_member WHERE role = 'admin' AND status = 'active'").get().n;
  assert.ok(active >= 1);
});

test('invalid role, status or over-long name is rejected', async () => {
  await recordStaffSignIn(db, 'x@legacyhomehealthservices.org', T0);
  assert.equal((await updateStaffMember(db, ADMIN, 'x@legacyhomehealthservices.org', { role: 'owner' })).status, 400);
  assert.equal((await updateStaffMember(db, ADMIN, 'x@legacyhomehealthservices.org', { status: 'gone' })).status, 400);
  assert.equal((await updateStaffMember(db, ADMIN, 'x@legacyhomehealthservices.org', { display_name: 'a'.repeat(121) })).status, 400);
  assert.equal((await updateStaffMember(db, ADMIN, 'nobody@legacyhomehealthservices.org', { role: 'staff' })).status, 404);
});

test('API: /api/staff/me, /api/staff/team and PATCH /api/staff/team (email in the body, not the URL)', async () => {
  const env = { LEGACY_DB: db, ALLOW_DEV_CONSOLE: '1' };
  const hdr = { 'x-dev-actor': ADMIN };
  const me = await (await getStaff({ request: request('https://x/api/staff/me', { headers: hdr }), env })).json();
  assert.equal(me.me.role, 'admin');
  const team = await (await getStaff({ request: request('https://x/api/staff/team', { headers: hdr }), env })).json();
  assert.ok(team.team.length >= 3);
  await recordStaffSignIn(db, 'y@legacyhomehealthservices.org', T0);
  const res = await patchStaff({ request: request('https://x/api/staff/team', { method: 'PATCH', headers: hdr, body: { email: 'y@legacyhomehealthservices.org', display_name: 'Yan' } }), env });
  assert.equal(res.status, 200);
  const bad = await patchStaff({ request: request('https://x/api/staff/team', { method: 'PATCH', headers: hdr, body: {} }), env });
  assert.equal(bad.status, 400);
});

test('console UI: Staff panel exists, loads with the console, and escapes what it renders', () => {
  assert.match(STAFF_HTML, /id="staffTeamPanel"/);
  assert.match(STAFF_HTML, /@legacyhomehealthservices\.org email/);
  assert.match(STAFF_JS, /loadStaffTeam\(\)\s*\n\s*\]\);/);
  assert.match(STAFF_JS, /const email = escapeHtml\(m\.email\)/);
  assert.match(STAFF_JS, /escapeHtml\(m\.display_name \|\| ''\)/);
  assert.doesNotMatch(STAFF_JS, /\/api\/staff\/team\/\$\{/, 'emails must not go into the URL');
});
