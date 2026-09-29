// Caregiver well-being check-in (schema 0012; client request 2026-09-29): a short check-in from the
// portal, a "My Wellness" trend for the caregiver, and a chart for staff with caregiver and time selectors.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  QUESTIONS, validateCheckin, scoreCheckin, isCheckinDue, recordCheckin, caregiverHistory,
  staffSeries, caregiversWithCheckins, CHECKIN_EVERY_DAYS,
} from '../functions/_lib/wellness.js';
import { onRequestGet as getPortal, onRequestPost as postPortal } from '../functions/api/portal/[[path]].js';
import { onRequestGet as getStaff } from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_5 = readFileSync(new URL('../schema/0005_portal_login.sql', import.meta.url), 'utf8');
const SCHEMA_12 = readFileSync(new URL('../schema/0012_wellness_checkin.sql', import.meta.url), 'utf8');
const PORTAL_HTML = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
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

const GOOD = { stress: 1, sleep: 5, support: 5, self_time: 5 };
const BAD = { stress: 5, sleep: 1, support: 1, self_time: 1 };

let raw;
let db;
let env;
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_5);
  raw.exec(SCHEMA_12);
  raw.exec("INSERT INTO caregiver (id, first_name, last_name, email, source) VALUES ('cg1','Jane','Doe','jane.doe@example.com','seed'), ('cg2','Sam','Lee','sam@example.com','seed')");
  db = d1(raw);
  env = { LEGACY_DB: db, PORTAL_TOKEN_SECRET: 'test-secret', ENVIRONMENT: 'development', PORTAL_DEV_RETURN_LINK: '1', ALLOW_DEV_CONSOLE: '1' };
});

async function signIn(email = 'jane.doe@example.com') {
  const res = await postPortal({ request: request('http://localhost/api/portal/login', { method: 'POST', body: { email } }), env });
  const link = (await res.json()).dev_link;
  const v = await getPortal({ request: request('http://localhost' + link), env });
  return decodeURIComponent(v.headers.get('Set-Cookie').split(';')[0]);
}

test('four questions, each 1 to 5, scored 0 to 100 where 100 is doing well', () => {
  assert.equal(QUESTIONS.length, 4);
  assert.equal(scoreCheckin(GOOD), 100);
  assert.equal(scoreCheckin(BAD), 0);
  assert.equal(scoreCheckin({ stress: 3, sleep: 3, support: 3, self_time: 3 }), 50);
});

test('validation: every answer required and in range; the note is optional and bounded', () => {
  assert.equal(validateCheckin({ answers: GOOD }).ok, true);
  assert.equal(validateCheckin({ answers: { ...GOOD, sleep: 6 } }).ok, false);
  assert.equal(validateCheckin({ answers: { stress: 1 } }).ok, false);
  assert.equal(validateCheckin({ answers: GOOD, note: 'x'.repeat(1001) }).ok, false);
  assert.equal(validateCheckin({ answers: GOOD, note: '  ' }).note, null);
});

test('a check-in is due with no history, and again after the interval', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(isCheckinDue(null, now), true);
  assert.equal(isCheckinDue('2026-09-25 12:00:00', now), false);
  assert.equal(isCheckinDue('2026-08-31 11:00:00', now), true);
  assert.equal(CHECKIN_EVERY_DAYS, 30);
});

test('portal: a signed-in caregiver checks in and sees only their own history', async () => {
  const cookie = await signIn();
  await recordCheckin(db, 'cg2', BAD, null); // someone else's
  let res = await getPortal({ request: request('http://localhost/api/portal/wellness', { headers: { Cookie: cookie } }), env });
  let data = await res.json();
  assert.equal(data.due, true);
  assert.equal(data.history.length, 0);
  assert.equal(data.questions.length, 4);
  res = await postPortal({ request: request('http://localhost/api/portal/wellness', { method: 'POST', headers: { Cookie: cookie }, body: { answers: GOOD, note: 'Doing ok' } }), env });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).score, 100);
  data = await (await getPortal({ request: request('http://localhost/api/portal/wellness', { headers: { Cookie: cookie } }), env })).json();
  assert.equal(data.history.length, 1);
  assert.equal(data.due, false);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wellness.checkin'").get().n, 2);
});

test('portal: one check-in a day, and no session means 401', async () => {
  const cookie = await signIn();
  const post = () => postPortal({ request: request('http://localhost/api/portal/wellness', { method: 'POST', headers: { Cookie: cookie }, body: { answers: GOOD } }), env });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 429);
  const anon = await getPortal({ request: request('http://localhost/api/portal/wellness'), env });
  assert.equal(anon.status, 401);
  const anonPost = await postPortal({ request: request('http://localhost/api/portal/wellness', { method: 'POST', body: { answers: GOOD } }), env });
  assert.equal(anonPost.status, 401);
});

test('staff: selector lists caregivers with check-ins; the chart returns per-caregiver series in range', async () => {
  raw.exec("INSERT INTO wellness_checkin (caregiver_id, answers_json, score, created_at) VALUES ('cg1','{}',40,datetime('now','-200 days')), ('cg1','{}',60,datetime('now','-40 days')), ('cg1','{}',80,datetime('now','-5 days')), ('cg2','{}',30,datetime('now','-10 days'))");
  const people = await caregiversWithCheckins(db);
  assert.deepEqual(people.map((p) => p.id).sort(), ['cg1', 'cg2']);
  let s = await staffSeries(db, ['cg1', 'cg2']);
  assert.equal(s.range, 'quarter');
  assert.deepEqual(s.series.find((x) => x.caregiver_id === 'cg1').points.map((p) => p.score), [60, 80]);
  s = await staffSeries(db, ['cg1'], 'month');
  assert.deepEqual(s.series[0].points.map((p) => p.score), [80]);
  s = await staffSeries(db, ['cg1'], 'year');
  assert.deepEqual(s.series[0].points.map((p) => p.score), [40, 60, 80]);
  s = await staffSeries(db, ['cg1'], 'forever');
  assert.equal(s.range, 'quarter', 'unknown range falls back to the quarter default');
  const api = await (await getStaff({ request: request('http://localhost/api/staff/wellness?caregiver=cg1&range=month'), env })).json();
  assert.equal(api.series[0].points.length, 1);
  const list = await (await getStaff({ request: request('http://localhost/api/staff/wellness'), env })).json();
  assert.equal(list.caregivers.length, 2);
});

test('caregiverHistory returns oldest first', async () => {
  raw.exec("INSERT INTO wellness_checkin (caregiver_id, answers_json, score, created_at) VALUES ('cg1','{}',10,'2026-07-01 00:00:00'), ('cg1','{}',90,'2026-09-01 00:00:00')");
  const h = await caregiverHistory(db, 'cg1');
  assert.deepEqual(h.map((x) => x.score), [10, 90]);
});

test('UI: portal My Wellness tile and staff wellness panel are wired, built with DOM APIs', () => {
  assert.match(PORTAL_HTML, /id="portalWellnessTile"/);
  assert.match(APP_JS, /loadWellness\(\);/);
  assert.match(APP_JS, /action === 'wellness-open'/);
  assert.match(APP_JS, /action === 'wellness-submit'/);
  assert.match(STAFF_HTML, /id="wellnessPanel"/);
  assert.match(STAFF_HTML, /<option value="quarter" selected>Last quarter<\/option>/);
  assert.match(STAFF_JS, /loadWellnessCaregivers\(\)/);
  assert.match(STAFF_JS, /opt\.textContent = /, 'caregiver names go in as text, not HTML');
  assert.doesNotMatch(APP_JS, /wellness[^\n]*innerHTML/, 'portal wellness UI never uses innerHTML');
});
