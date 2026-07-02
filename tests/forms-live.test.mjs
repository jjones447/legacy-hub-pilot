// Slice 04 tests: public forms are wired to the live intake contract.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
  assert.match(page, /id="supportForm" onsubmit="return submitSupport\(event\)"/);
  assert.match(page, /data-intake-success/);
  assert.match(page, /data-intake-error/);
  assert.match(page, /data-intake-routing/);
  assert.match(page, /consent to Legacy using these details/);
});

test('membership CTA opens the live membership modal instead of an alert stub', () => {
  const page = file('index.html');
  const app = file('app.js');
  assert.match(page, /onclick="openMembership\(\); return false;"/);
  assert.match(page, /id="membershipForm" onsubmit="return submitMembership\(event\)"/);
  assert.match(app, /kind: 'membership'/);
  assert.doesNotMatch(page, /membership interest form/);
});

test('event registration buttons carry registerable event ids', () => {
  const page = file('events.html');
  for (const id of [
    'ev_virtual_support_group',
    'ev_memory_social_jul18',
    'ev_wellness_grant_info_aug01',
    'ev_memory_social_caregiver_aug15',
  ]) {
    assert.match(page, new RegExp(id));
  }
  assert.match(page, /id="regForm" onsubmit="return submitRegister\(event\)"/);
  assert.match(file('app.js'), /event_id: eventId/);
  assert.match(page, /consent to Legacy using these details/);
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
