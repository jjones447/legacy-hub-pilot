// Slice 04 tests: public forms are wired to the live intake contract.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { handleIntake } from '../functions/api/_shared.mjs';

const ROOT = new URL('../', import.meta.url);
const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const EVENT_SEED = readFileSync(new URL('../schema/0002_seed_public_events.sql', import.meta.url), 'utf8');

function file(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

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
          };
        },
        async first() {
          return db.prepare(sql).get() ?? null;
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
    'grantName', 'grantEmail', 'grantRequestedFor', 'coachName', 'coachEmail', 'coachNote', 'regName', 'regEmail', 'regRole']) {
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
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(form.regions['[data-intake-error]'].style.display, 'block', `${id} shows its own failure`);
    const failed = requests.at(-1).body;
    status = 200;
    listeners.submit({ target: form, currentTarget: document, preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(form.regions['[data-intake-success]'].style.display, 'block', `${id} shows its own success`);
    assert.equal(form.regions['[data-intake-error]'].style.display, 'none');
    assert.equal(form.regions['[type="submit"]'].disabled, false);
    assert.equal(requests.at(-1).body.external_ref, failed.external_ref);
    if (id === 'regForm') assert.equal(failed.event_id, 'qa-fictional-event');
  }
  assert.equal(new Set(requests.map(request => request.body.external_ref)).size, cases.length,
    'separate forms never reuse an intake identity, including support and coaching');
});
