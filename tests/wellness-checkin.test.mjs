// Caregiver well-being check-in (schema 0012; client request 2026-09-29): a short check-in from the
// portal, a "My Wellness" trend for the caregiver, and a chart for staff with caregiver and time selectors.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import {
  QUESTIONS, validateCheckin, scoreCheckin, isCheckinDue, recordCheckin, caregiverHistory,
  staffSeries, caregiversWithCheckins, CHECKIN_EVERY_DAYS,
} from '../functions/_lib/wellness.js';
import { onRequestGet as getPortal, onRequestPost as postPortal } from '../functions/api/portal/[[path]].js';
import { confirmPortal } from './helpers/confirmed-portal.mjs';
import { onRequestGet as getStaff } from '../functions/api/staff/[[path]].js';
import { onRequestGet as getFollowups } from '../functions/api/followups.js';
import { onRequestGet as getEvents } from '../functions/api/events.js';
import { onRequestGet as getRegistrations } from '../functions/api/registrations.js';
import { onRequestGet as getGrants } from '../functions/api/grants/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_5 = readFileSync(new URL('../schema/0005_portal_login.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const SCHEMA_12 = readFileSync(new URL('../schema/0012_wellness_checkin.sql', import.meta.url), 'utf8');
const SCHEMA_17 = readFileSync(new URL('../schema/0017_event_details.sql', import.meta.url), 'utf8');
const SCHEMA_18 = readFileSync(new URL('../schema/0018_event_photos.sql', import.meta.url), 'utf8');
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
  env = { LEGACY_DB: db, PORTAL_TOKEN_SECRET: 'test-secret', EMAIL_API_KEY: 'synthetic-email-key', ALLOW_DEV_CONSOLE: '1' };
});

async function signIn(email = 'jane.doe@example.com') {
  // Production contract with a synthetic captured email; never rely on preview
  // identity bypass and never call a real email provider from this fixture.
  const realFetch = globalThis.fetch;
  let link;
  globalThis.fetch = async (_url, init) => {
    link = JSON.parse(init.body).text.match(/https?:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
    return { ok: true, status: 200 };
  };
  try {
    const res = await postPortal({ request: request('http://localhost/api/portal/login', { method: 'POST', body: { email } }), env });
    assert.deepEqual(await res.json(), { ok: true });
    const v = await confirmPortal({ request: request(link), env });
    return decodeURIComponent(v.headers.get('Set-Cookie').split(';')[0]);
  } finally {
    globalThis.fetch = realFetch;
  }
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

function wellnessUi() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.attributes = {}; this.classes = new Set();
      this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(child) { this.children.push(child); return child; }
  }
  const elements = Object.fromEntries(['portalWellnessSummary', 'portalWellnessBtn',
    'portalWellnessTrend', 'portalWellnessTrendHint'].map(id => [id, new Element()]));
  const source = APP_JS.slice(APP_JS.indexOf('function renderWellness('), APP_JS.indexOf('function openWellnessForm('));
  assert.ok(source.startsWith('function renderWellness('));
  const context = vm.createContext({ document: {
    getElementById: id => elements[id], createElementNS: (_namespace, tag) => new Element(tag)
  } });
  vm.runInContext(source, context);
  return { elements, render: data => context.renderWellness(data) };
}

test('UI clarity: the full interval is never presented as remaining days', () => {
  for (const interval of [30, 90]) {
    const { elements, render } = wellnessUi();
    render({ history: [{ score: 50, created_at: '2026-10-01 12:00:00' }], due: false, every_days: interval });
    assert.equal(elements.portalWellnessSummary.textContent,
      'Latest: 50 out of 100 (2026-10-01). Your next check-in will appear here when ready.');
    assert.equal(elements.portalWellnessBtn.classes.has('d-none'), true);
  }
});

test('UI clarity: empty and one-point histories explain why there is no trend yet', () => {
  const { elements, render } = wellnessUi();
  for (const history of [[], [{ score: 75, created_at: '2026-10-01 12:00:00' }]]) {
    render({ history, due: history.length === 0, every_days: 30 });
    assert.equal(elements.portalWellnessTrendHint.textContent, 'A trend appears after two check-ins.');
    assert.equal(elements.portalWellnessTrend.children.length, 0, 'no invented trend points');
  }
});

test('UI clarity: recent trend scores retain oldest-first order and a meaningful accessible label', () => {
  const { elements, render } = wellnessUi();
  render({ history: [{ score: 25, created_at: '2026-09-01 12:00:00' },
    { score: 75, created_at: '2026-10-01 12:00:00' }], due: false, every_days: 30 });
  assert.equal(elements.portalWellnessTrendHint.textContent, 'Scores shown oldest to newest.');
  const chart = elements.portalWellnessTrend.children[0];
  assert.equal(chart.attributes['aria-label'], 'Recent check-in scores, oldest to newest: 25, 75');
  assert.equal(chart.children[0].attributes.points, '4.0,43.0 236.0,17.0');
  render({ history: [], due: true, every_days: 30 });
  assert.equal(elements.portalWellnessTrend.children.length, 0, 'old chart clears with empty data');
});

test('UI clarity: ready check-ins keep the existing prompt and visible action', () => {
  const { elements, render } = wellnessUi();
  render({ history: [{ score: 50, created_at: '2026-09-01 12:00:00' }], due: true, every_days: 30 });
  assert.equal(elements.portalWellnessSummary.textContent,
    'Latest: 50 out of 100 (2026-09-01). Your next check-in is ready.');
  assert.equal(elements.portalWellnessBtn.classes.has('d-none'), false);
});

test('UI clarity: portal explains the four-answer nonclinical score without promising a profile page', () => {
  assert.match(PORTAL_HTML, /id="portalWellnessExplanation"/);
  assert.match(PORTAL_HTML, /four answers.*equal weight.*0–100/s);
  assert.match(PORTAL_HTML, /Less stress raises the score/);
  assert.match(PORTAL_HTML, /optional note does not affect this score/);
  assert.match(PORTAL_HTML, /personal check-in, not a clinical assessment/);
  assert.match(PORTAL_HTML, /Recent check-in scores/);
  const intro = PORTAL_HTML.match(/<p class="sub">([^<]+)<\/p>/)?.[1];
  assert.ok(intro);
  assert.doesNotMatch(intro, /profile/i);
  assert.match(intro, /wellness check-ins/);
});

test('internal QA test accounts use normal portal sign-in but are excluded from customer counts, lists, queues, events, grants, wellness reports, and recent-changes while preserving xcentric-test sample rows', async () => {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS award (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grant_application_id INTEGER NOT NULL REFERENCES grant_application(id),
      amount TEXT,
      care_package TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (grant_application_id)
    );
  `);
  raw.exec(SCHEMA_6);
  raw.exec(SCHEMA_17);
  raw.exec(SCHEMA_18);
  raw.exec(`
    INSERT INTO caregiver (id, first_name, last_name, email, source, status, segment_tags)
    VALUES
      ('cg_qa_prod', 'TEST - Legacy - PROD', 'Caregiver - Portal QA', 'qa.prod@example.test', 'qa_account_prod', 'inactive', '["qa_test","do_not_contact","exclude_reporting","qa_prod","purpose_portal","owner_legacy_delivery"]'),
      ('cg_qa_source_only', 'TEST - Legacy - SourceOnly', 'Caregiver - Portal QA', 'qa.source@example.test', 'qa_account_staging', 'inactive', '[]'),
      ('cg_qa_tag', 'Tagged QA', 'Account', 'qa.tag@example.test', 'staff', 'active', '["qa_test","exclude_reporting"]'),
      ('cg_qatar', 'Noor', 'Al-Thani', 'noor@example.org', 'qatar_referral', 'active', '[]'),
      ('cg_sample', 'Sample', 'Owner', 'sample.owner@example.test', 'pc2-codex-13-admin-test', 'active', '["xcentric-test"]');
    INSERT INTO event (id, title, type, starts_at, publish_state)
    VALUES ('ev_qa_check', 'Support Group', 'support_group', '2026-11-15T18:00:00Z', 'published');
    INSERT INTO registration (caregiver_id, event_id, status, source, external_ref)
    VALUES
      ('cg1', 'ev_qa_check', 'registered', 'site_form', 'reg_cg1'),
      ('cg_qatar', 'ev_qa_check', 'registered', 'site_form', 'reg_qatar'),
      ('cg_qa_prod', 'ev_qa_check', 'registered', 'portal', 'reg_qa_prod'),
      ('cg_qa_source_only', 'ev_qa_check', 'registered', 'portal', 'reg_qa_source'),
      ('cg_qa_tag', 'ev_qa_check', 'attended', 'staff', 'reg_qa_tag');
    INSERT INTO followup (caregiver_id, kind, detail, status, source, external_ref)
    VALUES
      ('cg1', 'support_request', 'Real caregiver follow-up', 'open', 'site_form', 'fu_cg1'),
      ('cg_qatar', 'support_request', 'Qatar referral follow-up', 'open', 'site_form', 'fu_qatar'),
      ('cg_qa_prod', 'support_request', 'QA follow-up', 'open', 'portal', 'fu_qa_prod'),
      ('cg_qa_source_only', 'support_request', 'QA source follow-up', 'open', 'portal', 'fu_qa_source'),
      ('cg_qa_tag', 'support_request', 'Tagged QA follow-up', 'open', 'portal', 'fu_qa_tag');
    INSERT INTO grant_application (caregiver_id, requested_for, status, source, external_ref)
    VALUES
      ('cg1', 'Respite care', 'submitted', 'site_form', 'gr_cg1'),
      ('cg_qatar', 'Respite care', 'submitted', 'site_form', 'gr_qatar'),
      ('cg_qa_prod', 'QA respite test', 'submitted', 'portal', 'gr_qa_prod'),
      ('cg_qa_source_only', 'QA source respite test', 'submitted', 'portal', 'gr_qa_source'),
      ('cg_qa_tag', 'Tagged QA respite test', 'submitted', 'portal', 'gr_qa_tag');
    INSERT INTO wellness_checkin (caregiver_id, answers_json, score, created_at)
    VALUES
      ('cg1', '{}', 75, datetime('now', '-5 days')),
      ('cg_qatar', '{}', 82, datetime('now', '-4 days')),
      ('cg_qa_prod', '{}', 90, datetime('now', '-3 days')),
      ('cg_qa_source_only', '{}', 88, datetime('now', '-2 days')),
      ('cg_qa_tag', '{}', 85, datetime('now', '-2 days')),
      ('cg_sample', '{}', 80, datetime('now', '-1 days'));
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES
      ('staff@example.com', 'caregiver.update', 'caregiver', 'cg1', '{"status":"inactive"}', '{"status":"active"}'),
      ('staff@example.com', 'caregiver.update', 'caregiver', 'cg_qatar', '{"status":"inactive"}', '{"status":"active"}'),
      ('staff@example.com', 'caregiver.update', 'caregiver', 'cg_qa_prod', '{"status":"inactive"}', '{"status":"active"}'),
      ('staff@example.com', 'caregiver.update', 'caregiver', 'cg_qa_source_only', '{"status":"inactive"}', '{"status":"active"}'),
      ('staff@example.com', 'caregiver.update', 'caregiver', 'cg_qa_tag', '{"status":"inactive"}', '{"status":"active"}');
  `);

  // 1. Normal portal sign-in & check-in works for the internal QA account
  const qaCookie = await signIn('qa.prod@example.test');
  const meRes = await getPortal({ request: request('http://localhost/api/portal/me', { headers: { Cookie: qaCookie } }), env });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.profile.id, 'cg_qa_prod');

  // 2. Default staff caregiver search & customer counts exclude internal QA rows but preserve cg1, cg2, cg_qatar ('qatar_referral'), and cg_sample
  const defaultList = await (await getStaff({ request: request('http://localhost/api/staff/caregivers'), env })).json();
  assert.equal(defaultList.total, 4);
  assert.deepEqual(defaultList.caregivers.map((c) => c.id).sort(), ['cg1', 'cg2', 'cg_qatar', 'cg_sample']);

  const nameSearch = await (await getStaff({ request: request('http://localhost/api/staff/caregivers?q=Portal%20QA'), env })).json();
  assert.equal(nameSearch.total, 0);
  assert.equal(nameSearch.caregivers.length, 0);

  // Explicit internal QA segment filter in Staff UI and API allows operators to inspect all internal QA test accounts intentionally
  assert.match(STAFF_HTML, /<select id="caregiverSearchSegment"[\s\S]*?<option value="qa_test">Internal QA<\/option>/);
  const qaSegmentList = await (await getStaff({ request: request('http://localhost/api/staff/caregivers?segment=qa_test'), env })).json();
  assert.equal(qaSegmentList.total, 3);
  assert.deepEqual(qaSegmentList.caregivers.map((c) => c.id).sort(), ['cg_qa_prod', 'cg_qa_source_only', 'cg_qa_tag']);

  // Direct caregiver profile lookup by id still works for targeted inspection
  const directProfile = await (await getStaff({ request: request('http://localhost/api/staff/caregiver/cg_qa_prod'), env })).json();
  assert.equal(directProfile.ok, true);
  assert.equal(directProfile.profile.id, 'cg_qa_prod');

  // 3. Wellness selector and series exclude internal QA rows while preserving cg1, cg_qatar, and cg_sample
  const wellnessPeople = await caregiversWithCheckins(db);
  assert.deepEqual(wellnessPeople.map((p) => p.id).sort(), ['cg1', 'cg_qatar', 'cg_sample']);
  const series = await staffSeries(db, ['cg1', 'cg_qatar', 'cg_qa_prod', 'cg_qa_source_only', 'cg_qa_tag', 'cg_sample']);
  assert.deepEqual(series.series.map((s) => s.caregiver_id).sort(), ['cg1', 'cg_qatar', 'cg_sample']);

  // 4. Staff queue and /api/followups exclude internal QA rows while preserving cg1 and cg_qatar
  const queueData = await (await getStaff({ request: request('http://localhost/api/staff/queue'), env })).json();
  assert.deepEqual(queueData.queue.map((f) => f.caregiver_id).sort(), ['cg1', 'cg_qatar']);
  const followupsData = await (await getFollowups({ env })).json();
  assert.deepEqual(followupsData.followups.map((f) => f.first_name).sort(), ['Jane', 'Noor']);

  // 5. Public events, staff events, and event registrations exclude internal QA registrations while preserving cg1 and cg_qatar
  const pubEvents = await (await getEvents({ env })).json();
  assert.equal(pubEvents.events.find((e) => e.id === 'ev_qa_check').registered_count, 2);
  const staffEvents = await (await getStaff({ request: request('http://localhost/api/staff/events'), env })).json();
  assert.equal(staffEvents.events.find((e) => e.id === 'ev_qa_check').registered_count, 2);
  const regData = await (await getRegistrations({ request: request('http://localhost/api/registrations?event_id=ev_qa_check'), env })).json();
  assert.deepEqual(regData.registrations.map((r) => r.caregiver_id).sort(), ['cg1', 'cg_qatar']);

  // 6. Staff grants list excludes internal QA rows (both unfiltered and status-filtered) while preserving cg1 and cg_qatar
  const allGrants = await (await getGrants({ request: request('http://localhost/api/grants'), env })).json();
  assert.deepEqual(allGrants.grants.map((g) => g.caregiver_id).sort(), ['cg1', 'cg_qatar']);
  const submittedGrants = await (await getGrants({ request: request('http://localhost/api/grants?status=submitted'), env })).json();
  assert.deepEqual(submittedGrants.grants.map((g) => g.caregiver_id).sort(), ['cg1', 'cg_qatar']);

  // 7. Staff recent-changes excludes caregiver audit entries for internal QA rows while preserving cg1 and cg_qatar
  const recentChanges = await (await getStaff({ request: request('http://localhost/api/staff/recent-changes'), env })).json();
  assert.deepEqual(
    recentChanges.changes.filter((c) => c.entity === 'caregiver').map((c) => c.entity_id).sort(),
    ['cg1', 'cg_qatar']
  );
});
