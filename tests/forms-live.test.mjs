// Slice 04 tests: public forms are wired to the live intake contract.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { handleIntake } from '../functions/api/_shared.mjs';
import { onRequestPost as postIntake } from '../functions/api/intake.js';
import { onRequestGet as getStaff } from '../functions/api/staff/[[path]].js';

const ROOT = new URL('../', import.meta.url);
const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const EVENT_SEED = readFileSync(new URL('../schema/0002_seed_public_events.sql', import.meta.url), 'utf8');

function file(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

function d1(db) {
  return {
    batchCalls: 0,
    async batch(statements) {
      this.batchCalls++;
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push({ success: true, meta: await statement.run() });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
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
          };
        },
        async first() {
          return db.prepare(sql).get() ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all() };
        },
      };
    },
  };
}

let raw;
let db;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  raw.exec(EVENT_SEED);
  db = d1(raw);
});

test('shared frontend intake client posts JSON to the Worker endpoint', () => {
  const app = file('app.js');
  assert.match(app, /const INTAKE_ENDPOINT = '\/api\/intake'/);
  assert.match(app, /function postIntake/);
  assert.match(app, /method: 'POST'/);
  assert.match(app, /headers: \{ 'Content-Type': 'application\/json' \}/);
  assert.match(app, /function intakeExternalRef/);
  assert.match(app, /sessionStorage\.setItem/);
});

test('request support form renders privacy copy and live status regions', () => {
  const page = file('request-support.html');
  assert.match(page, /id="supportForm" data-action="submit-support"/);
  assert.match(file('app.js'), /action === 'submit-support'[\s\S]*submitSupport/);
  assert.match(page, /data-intake-success/);
  assert.match(page, /data-intake-error/);
  assert.match(page, /data-intake-routing/);
  assert.match(page, /consent to Legacy using these details/);
});

test('membership CTA opens the live membership modal instead of an alert stub', () => {
  const page = file('index.html');
  const app = file('app.js');
  assert.match(page, /data-action="open-membership"/);
  assert.match(app, /action === 'open-membership'[\s\S]*openMembership/);
  assert.match(page, /id="membershipForm" data-action="submit-membership"/);
  assert.match(app, /action === 'submit-membership'[\s\S]*submitMembership/);
  assert.match(app, /kind: 'membership'/);
  assert.doesNotMatch(page, /membership interest form/);
});

test('event registration uses published API identities and the live intake form', () => {
  const page = file('events.html');
  const app = file('app.js');
  // The renderer tests exercise API -> registration button -> modal identity.
  // Static seed IDs are fixtures, not confirmation that their old dates are live.
  assert.match(page, /id="liveEventsGrid"/);
  assert.match(app, /fetch\('\/api\/events'\)/);
  assert.match(app, /button\.dataset\.eventId = event\.id/);
  assert.match(page, /id="regForm" data-action="submit-register"/);
  assert.match(app, /action === 'submit-register'[\s\S]*submitRegister/);
  assert.match(app, /event_id: eventId/);
  assert.match(page, /consent to Legacy using these details/);
});

test('programs grant and coaching CTAs open live intake modals instead of alert stubs', () => {
  const page = file('programs.html');
  const tmpl = file('templates/programs.html.j2');
  const app = file('app.js');
  assert.match(page, /data-action="open-grant-apply"/);
  assert.match(app, /action === 'open-grant-apply'[\s\S]*openGrantApply/);
  assert.match(page, /id="grantApplyForm" data-action="submit-grant-apply"/);
  assert.match(app, /action === 'submit-grant-apply'[\s\S]*submitGrantApply/);
  assert.match(page, /data-action="open-coaching-interest"/);
  assert.match(app, /action === 'open-coaching-interest'[\s\S]*openCoachingInterest/);
  assert.match(page, /id="coachingInterestForm" data-action="submit-coaching-interest"/);
  assert.match(app, /action === 'submit-coaching-interest'[\s\S]*submitCoachingInterest/);
  assert.match(tmpl, /data-action="open-grant-apply"/);
  assert.match(tmpl, /data-action="open-coaching-interest"/);
  assert.match(app, /kind: 'grant_application'/);
  assert.match(app, /source: 'site_form:coaching'/);
  assert.match(app, /kind: 'support_request'/);
  assert.doesNotMatch(page, /Apply for a Wellness Grant[\s\S]*alert\(/);
  assert.doesNotMatch(page, /Join the interest list[\s\S]{0,80}alert\(/);
});

test('seeded public events are accepted by the intake core', async () => {
  const events = raw.prepare(`SELECT COUNT(*) AS n FROM event WHERE publish_state='published'`).get();
  assert.equal(events.n, 4);

  const res = await handleIntake(db, {
    kind: 'event_registration',
    first_name: 'Rita',
    email: 'rita@example.org',
    event_id: 'ev_memory_social_jul18',
    external_ref: 'forms-live-r1',
  });

  assert.equal(res.status, 201);
  const registration = raw.prepare(`SELECT * FROM registration WHERE event_id='ev_memory_social_jul18'`).get();
  assert.ok(registration);
});

// Exercise the actual delegated submit listener: currentTarget is document,
// while target is the submitted form. Multiple forms coexist on Programs.
test('delegated intake submits keep status, event identity and retry keys on their own form', async () => {
  const app = file('app.js');
  const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'))
    + app.slice(app.indexOf('function openRegister('), app.indexOf("document.addEventListener('click'"))
    + app.slice(app.indexOf("document.addEventListener('submit'"), app.indexOf('/* ---------- Portal: My Wellness'));
  const cases = [
    ['supportForm', 'submit-support'], ['membershipForm', 'submit-membership'],
    ['grantApplyForm', 'submit-grant-apply'], ['coachingInterestForm', 'submit-coaching-interest'],
    ['supportGroupInterestForm', 'submit-support-group-interest'],
    ['regForm', 'submit-register'],
  ];
  const forms = Object.fromEntries(cases.map(([id, action]) => {
    const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]']
      .map(selector => [selector, { style: { display: 'none' }, disabled: false, textContent: '' }]));
    const form = { id, dataset: { eventId: 'qa-fictional-event' }, regions,
      querySelector: selector => regions[selector], getAttribute: () => action,
      closest: () => form };
    return [id, form];
  }));
  const inputs = {};
  for (const id of ['supName', 'supEmail', 'supWho', 'supWhat', 'supMsg', 'memName', 'memEmail', 'memCaringFor', 'memNote',
    'grantName', 'grantEmail', 'grantRequestedFor', 'coachName', 'coachEmail', 'coachNote', 'supportGroupName', 'supportGroupEmail', 'regName', 'regEmail', 'regRole']) {
    inputs[id] = { value: id.endsWith('Email') ? 'qa@example.invalid' : 'QA Fictional' };
  }
  const requests = [], storage = new Map(), listeners = {};
  let status = 503, serial = 0;
  const document = {
    getElementById: id => forms[id] || inputs[id],
    addEventListener: (name, handler) => { listeners[name] = handler; },
    querySelector: selector => forms.membershipForm.querySelector(selector),
  };
  vm.runInNewContext(source, {
    document, crypto: { randomUUID: () => `fictional-ref-${++serial}` },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: status === 200, status, json: async () => ({ ok: status === 200, error: 'synthetic_unavailable' }) };
    },
  });
  for (const [id] of cases) {
    const form = forms[id];
    status = 503;
    listeners.submit({ target: form, currentTarget: document, preventDefault() {} });
    assert.equal(form.regions['[type="submit"]'].disabled, true, `${id} disables its own button`);
    assert.equal(form.regions['[data-intake-routing]'].style.display, 'none', `${id} hides joining/routing details while pending`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(form.regions['[data-intake-error]'].style.display, 'block', `${id} shows its own failure`);
    assert.equal(form.regions['[data-intake-routing]'].style.display, 'none', `${id} hides joining/routing details after failure`);
    const failed = requests.at(-1).body;
    status = 200;
    listeners.submit({ target: form, currentTarget: document, preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(form.regions['[data-intake-success]'].style.display, 'block', `${id} shows its own success`);
    assert.equal(form.regions['[data-intake-routing]'].style.display, 'block', `${id} reveals details only after acknowledgment`);
    assert.equal(form.regions['[data-intake-error]'].style.display, 'none');
    assert.equal(form.regions['[type="submit"]'].disabled, false);
    assert.equal(requests.at(-1).body.external_ref, failed.external_ref);
    if (id === 'regForm') assert.equal(failed.event_id, 'qa-fictional-event');
  }
  assert.equal(new Set(requests.map(request => request.body.external_ref)).size, cases.length,
    'separate forms never reuse an intake identity, including support and coaching');
});


test('support-group sign-up is a named native dialog with only name/email, then goes to Google Meet', () => {
  const page = file('programs.html');
  const dialog = page.match(/<dialog id="supportGroupInterestModal"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  assert.match(dialog, /aria-labelledby="supportGroupInterestTitle" aria-describedby="supportGroupInterestDescription"/);
  assert.match(page, /data-action="open-support-group-interest" data-session="[^"]+" data-session-date="\d{4}-\d{2}-\d{2}" aria-haspopup="dialog" aria-controls="supportGroupInterestModal"/);
  assert.equal((dialog.match(/<input /g) || []).length, 2);
  assert.match(dialog, /<label for="supportGroupName">Your name<\/label>/);
  assert.match(dialog, /<label for="supportGroupEmail">Email<\/label>/);
  assert.match(dialog, /type="email" autocomplete="email" required/);
  assert.match(dialog, /data-action="close-support-group-interest" aria-label="Close support group sign-up form"/);
  assert.match(dialog, /Join the Virtual Caregiver Support Group/);
  assert.match(dialog, /When you submit, we'll take you straight to the group on Google Meet/);
  assert.match(dialog, /consent to Legacy using your name and email to find or create your caregiver record/);
  assert.match(dialog, /does not subscribe you to reminders/);
  assert.match(dialog, /data-intake-success role="status" aria-live="polite"/);
  assert.match(dialog, /data-intake-error role="alert" aria-live="assertive"/);
  assert.doesNotMatch(dialog, /<textarea|event_id|type="date"/);
  const joiningRegion = dialog.match(/<div class="routing-note" data-intake-routing>([\s\S]*?)<\/div>/)?.[1];
  assert.match(joiningRegion, /href="https:\/\/meet\.google\.com\/dmc-orwi-afk" target="_blank" rel="noopener noreferrer"/);
  assert.match(joiningRegion, /If Google Meet doesn't open/);
  assert.equal((dialog.match(/meet\.google\.com/g) || []).length, 1);
  assert.match(file('programs-events.html'), /<a href="programs\.html#support-group">View upcoming sessions<\/a>/);
  assert.doesNotMatch(file('programs-events.html'), /Join an upcoming session/);
  const panel = page.match(/<section class="section-sand" id="support-group">[\s\S]*?<\/section>/)?.[0];
  assert.equal((panel.match(/class="btn /g) || []).length, 0, 'the dates are the way to join; no separate join button');
  assert.doesNotMatch(panel, /Join an upcoming session/);
  assert.match(panel, /data-action="toggle-support-group-sessions" aria-controls="supportGroupSessions" aria-expanded="false" hidden>View upcoming sessions<\/button>/);
  const expected = [['2026-11-04', 'November 4'], ['2026-11-11', 'November 11'], ['2026-11-18', 'November 18'],
    ['2026-12-02', 'December 2'], ['2026-12-09', 'December 9'], ['2026-12-16', 'December 16'], ['2026-12-30', 'December 30']];
  for (const [iso, day] of expected) {
    const date = `Wednesday, ${day} · 5–6 PM`;
    assert.ok(panel.includes(`<li data-date="${iso}"><button type="button" class="session-link" data-action="open-support-group-interest" data-session="${date}" data-session-date="${iso}" aria-haspopup="dialog" aria-controls="supportGroupInterestModal">${date}</button></li>`), date);
  }
  assert.doesNotMatch(panel, /December 23|2026-12-23/);
  assert.match(dialog, /<p class="session-note" id="supportGroupSession" hidden><\/p>/);
  assert.doesNotMatch(panel, /November 25/);
});

test('support-group delegated request reaches its own shared staff task and original audit without membership or registration', async () => {
  const app = file('app.js');
  const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'))
    + app.slice(app.indexOf('function openRegister('), app.indexOf("document.addEventListener('click'"))
    + app.slice(app.indexOf("document.addEventListener('submit'"), app.indexOf('/* ---------- Portal: My Wellness'));
  const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]']
    .map(selector => [selector, { style: { display: 'none' }, disabled: false, textContent: '' }]));
  const form = { id: 'supportGroupInterestForm', querySelector: selector => regions[selector],
    getAttribute: () => 'submit-support-group-interest', closest: () => form };
  const listeners = {}, dialogHandlers = {}, storage = new Map(), requests = [];
  let inputFocus = 0, openerFocus = 0;
  const opener = { focus() { openerFocus++; } };
  const dialog = { open: false,
    showModal() { this.open = true; },
    close() { this.open = false; dialogHandlers.close(); },
    addEventListener: (name, handler) => { dialogHandlers[name] = handler; },
  };
  const nodes = { supportGroupInterestModal: dialog, supportGroupInterestForm: form,
    supportGroupName: { value: 'Demo Group', focus() { inputFocus++; } },
    supportGroupEmail: { value: 'group-interest@example.invalid' } };
  regions['[data-intake-routing] a[href^="https://meet.google.com/"]'] = { getAttribute: () => 'https://meet.google.com/dmc-orwi-afk' };
  const assigned = [];
  const context = {
    window: { location: { assign: url => assigned.push(url) } },
    document: { activeElement: opener, getElementById: id => nodes[id],
      addEventListener: (name, handler) => { listeners[name] = handler; } },
    crypto: { randomUUID: () => 'fictional-support-group-ref' },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return postIntake({ request: new Request('https://example.invalid/api/intake', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.30' },
        body: options.body,
      }), env: { LEGACY_DB: db } });
    },
  };
  vm.runInNewContext(source, context);
  context.openSupportGroupInterest(opener);
  assert.equal(dialog.open, true);
  assert.equal(inputFocus, 1);
  context.closeSupportGroupInterest();
  assert.equal(dialog.open, false);
  assert.equal(openerFocus, 1);
  listeners.submit({ target: form, currentTarget: context.document, preventDefault() {} });
  assert.equal(regions['[type="submit"]'].disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(regions['[data-intake-success]'].style.display, 'block');
  assert.deepEqual(assigned, ['https://meet.google.com/dmc-orwi-afk'], 'a saved sign-up goes straight to Google Meet');
  assert.deepEqual(requests[0].payload, {
    kind: 'support_request', source: 'site_form:support_group',
    external_ref: 'fictional-support-group-ref', first_name: 'Demo', last_name: 'Group',
    email: 'group-interest@example.invalid', message: 'Signed up for the Virtual Caregiver Support Group', session_date: null,
  });
  const caregiver = raw.prepare(`SELECT * FROM caregiver WHERE email = ?`).get('group-interest@example.invalid');
  assert.equal(caregiver.sanctuary_member, 0);
  const queue = await (await getStaff({ request: new Request('https://example.invalid/api/staff/queue'), env: { LEGACY_DB: db } })).json();
  assert.equal(queue.queue.length, 1);
  assert.equal(queue.queue[0].caregiver_id, caregiver.id);
  assert.equal(queue.queue[0].source, 'site_form:support_group');
  assert.equal(queue.queue[0].kind, 'support_request');
  assert.equal(queue.queue[0].detail, 'Signed up for the Virtual Caregiver Support Group');
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE action = 'intake.support_request'`).get();
  assert.equal(audit.actor, 'site_form:support_group');
  assert.equal(audit.entity_id, caregiver.id);
  assert.deepEqual(JSON.parse(audit.after_json), { kind: 'support_request', external_ref: 'fictional-support-group-ref', event_id: null });
  listeners.submit({ target: form, currentTarget: context.document, preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[1].payload.external_ref, requests[0].payload.external_ref);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM followup`).get().n, 1);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'intake.support_request'`).get().n, 1);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM registration`).get().n, 0);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM grant_application`).get().n, 0);
  context.openSupportGroupInterest(opener);
  assert.equal(regions['[data-intake-routing]'].style.display, 'none', 'reopening does not expose an old success/link');
});

test('support-group joining details stay hidden for failed, missing or unreadable acknowledgments', async () => {
  const app = file('app.js');
  const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'));
  const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]']
    .map(selector => [selector, { style: { display: 'none' }, disabled: false, textContent: '' }]));
  const form = { id: 'supportGroupInterestForm', querySelector: selector => regions[selector] };
  const nodes = { supportGroupInterestForm: form, supportGroupName: { value: 'Fictional Name' },
    supportGroupEmail: { value: 'fictional@example.invalid' } };
  regions['[data-intake-routing] a[href^="https://meet.google.com/"]'] = { getAttribute: () => 'https://meet.google.com/dmc-orwi-afk' };
  const assigned = [];
  const context = { window: { location: { assign: url => assigned.push(url) } }, document: { getElementById: id => nodes[id] },
    crypto: { randomUUID: () => 'fictional-ack-check' },
    sessionStorage: { getItem: () => 'fictional-ack-check', setItem() {} }, fetch: null };
  vm.runInNewContext(source, context);
  const failures = [
    async () => { throw new Error('synthetic network failure'); },
    async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } }),
    async () => ({ ok: false, status: 503, json: async () => ({ ok: true }) }),
  ];
  for (const response of failures) {
    context.setFormState(form, 'success'); // an earlier success must not leak into a new request
    context.fetch = response;
    context.submitSupportGroupInterest({ preventDefault() {} });
    assert.equal(regions['[data-intake-routing]'].style.display, 'none');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(regions['[data-intake-error]'].style.display, 'block');
    assert.equal(regions['[data-intake-success]'].style.display, 'none');
    assert.equal(regions['[data-intake-routing]'].style.display, 'none');
  }
  assert.deepEqual(assigned, [], 'an unconfirmed sign-up never sends anyone to Google Meet');
});


test('support-group dialog overrides the global margin reset with scoped native viewport centering', () => {
  const styles = file('styles.css');
  const dialog = styles.match(/#supportGroupInterestModal\s*\{([^}]+)\}/)?.[1];
  assert.ok(dialog, 'native dialog needs scoped geometry after the global reset');
  assert.match(dialog, /margin:\s*auto/);
  assert.match(dialog, /border:\s*0/);
  assert.match(dialog, /width:\s*calc\(100% - 40px\)/);
  assert.match(dialog, /max-height:\s*calc\(100vh - 40px\)/);
  assert.match(dialog, /max-height:\s*calc\(100dvh - 40px\)/);
  assert.match(styles, /#supportGroupInterestModal::backdrop\s*\{[^}]*rgba\(43,\s*35,\s*51,\s*0\.55\)/);
});

test('support-group: clicking a session date shows it in the form and saves it with the sign-up', async () => {
  const app = file('app.js');
  const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'));
  const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]']
    .map(selector => [selector, { style: { display: 'none' }, disabled: false, textContent: '' }]));
  regions['[data-intake-routing] a[href^="https://meet.google.com/"]'] = { getAttribute: () => 'https://meet.google.com/dmc-orwi-afk' };
  const form = { id: 'supportGroupInterestForm', querySelector: selector => regions[selector] };
  const note = { textContent: '', hidden: true };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener() {} };
  const nodes = { supportGroupInterestModal: dialog, supportGroupInterestForm: form, supportGroupSession: note,
    supportGroupName: { value: 'Fictional Person', focus() {} }, supportGroupEmail: { value: 'fictional@example.invalid' } };
  const posted = []; const assigned = [];
  const context = { window: { location: { assign: url => assigned.push(url) } }, document: { getElementById: id => nodes[id] },
    crypto: { randomUUID: (() => { let n = 0; return () => `fictional-session-ref-${++n}`; })() },
    sessionStorage: (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })(),
    fetch: async (url, options) => { posted.push(JSON.parse(options.body)); return { ok: true, status: 201, json: async () => ({ ok: true }) }; } };
  vm.runInNewContext(source, context);
  const opener = date => ({ getAttribute: name => (name === 'data-session' ? `Wednesday, November ${date} · 5–6 PM` : name === 'data-session-date' ? `2026-11-${date}` : null), focus() {} });
  context.openSupportGroupInterest(opener('11'));
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Session: Wednesday, November 11 · 5–6 PM');
  context.submitSupportGroupInterest({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted[0].message, 'Signed up for the Virtual Caregiver Support Group — Wednesday, November 11 · 5–6 PM');
  assert.equal(posted[0].session_date, '2026-11-11');
  // A second date in the same tab is its own sign-up: a different idempotency key.
  dialog.open = false;
  context.openSupportGroupInterest(opener('18'));
  context.submitSupportGroupInterest({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted[1].session_date, '2026-11-18');
  assert.notEqual(posted[1].external_ref, posted[0].external_ref, 'each date has its own sign-up identity');
  // Re-submitting the same date reuses its key (server-side duplicate, no second sign-up).
  dialog.open = false;
  context.openSupportGroupInterest(opener('11'));
  context.submitSupportGroupInterest({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted[2].external_ref, posted[0].external_ref);
  assert.deepEqual(assigned, ['https://meet.google.com/dmc-orwi-afk']);
  // Opening from the general button clears any earlier date.
  dialog.open = false;
  context.openSupportGroupInterest({ getAttribute: () => null, focus() {} });
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, '');
});

test('support-group dates: past sessions hide, only the next shows until "View upcoming sessions" expands the rest', () => {
  const app = file('app.js');
  const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'));
  const isos = ['2026-11-04', '2026-11-11', '2026-11-18', '2026-12-02', '2026-12-30'];
  const items = isos.map(iso => ({ hidden: false, getAttribute: name => (name === 'data-date' ? iso : null) }));
  const list = { querySelectorAll: () => items };
  const more = { hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } };
  const none = { classList: { on: true, toggle(_c, force) { this.on = force; } } };
  const nodes = { supportGroupSessions: list, supportGroupSessionsMore: more, supportGroupSessionsNone: none };
  const context = { document: { getElementById: id => nodes[id] }, crypto: { randomUUID: () => 'x' }, sessionStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(source, context);
  context.applySupportGroupSessions(false, '2026-11-12');
  assert.deepEqual(items.map(i => i.hidden), [true, true, false, true, true], 'only the next session (Nov 18) shows');
  assert.equal(more.hidden, false);
  assert.equal(more.attrs['aria-expanded'], 'false');
  context.toggleSupportGroupSessions(more);
  // toggle uses today's real date; re-apply with the fixed date to check expansion
  context.applySupportGroupSessions(true, '2026-11-12');
  assert.deepEqual(items.map(i => i.hidden), [true, true, false, false, false], 'expanded shows every upcoming date, never past ones');
  assert.equal(more.attrs['aria-expanded'], 'true');
  context.applySupportGroupSessions(false, '2026-12-30');
  assert.deepEqual(items.map(i => i.hidden), [true, true, true, true, false]);
  assert.equal(more.hidden, true, 'no "View upcoming sessions" link when only one date is left');
  context.applySupportGroupSessions(false, '2027-01-01');
  assert.ok(items.every(i => i.hidden));
  assert.equal(none.classList.on, false, 'shows "New session dates are coming soon." when none are left');
});
