// Slice 05 tests — Events v1 dynamic APIs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getEvents } from '../functions/api/events.js';
import { onRequestGet as getFollowups, onRequestPost as postFollowups } from '../functions/api/followups.js';
import { onRequestGet as getRegistrations, onRequestPost as postRegistrations } from '../functions/api/registrations.js';

const SCHEMA = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const EVENT_SEED = readFileSync(new URL('../schema/0002_seed_public_events.sql', import.meta.url), 'utf8');

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

let raw;
let env;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  raw.exec(EVENT_SEED);
  env = { LEGACY_DB: d1(raw) };
});

test('GET /api/events returns all published events with current registration counts', async () => {
  // Let's add a caregiver and a registration.
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_test_1', 'Maria', 'maria@example.org')`).run();
  raw.prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES ('cg_test_1', 'ev_memory_social_jul18', 'test', 'ref_1')`).run();

  const response = await getEvents({ env });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.ok);
  assert.equal(data.events.length, 4);

  const supportGroup = data.events.find(e => e.id === 'ev_virtual_support_group');
  assert.equal(supportGroup.registered_count, 0);

  const memorySocial = data.events.find(e => e.id === 'ev_memory_social_jul18');
  assert.equal(memorySocial.registered_count, 1);
});

test('GET/POST /api/followups allows viewing and updating followups', async () => {
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_test_1', 'Maria', 'maria@example.org')`).run();
  raw.prepare(`INSERT INTO followup (caregiver_id, kind, detail, status, source, external_ref) VALUES ('cg_test_1', 'support_request', 'Help me', 'open', 'test', 'ref_2')`).run();

  // GET
  const getRes = await getFollowups({ env });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.followups.length, 1);
  assert.equal(getData.followups[0].first_name, 'Maria');
  assert.equal(getData.followups[0].status, 'open');

  const followupId = getData.followups[0].id;

  // POST (update status)
  const req = new Request('http://localhost/api/followups', {
    method: 'POST',
    body: JSON.stringify({ id: followupId, status: 'done' })
  });
  const postRes = await postFollowups({ request: req, env });
  assert.equal(postRes.status, 200);

  const statusVal = raw.prepare(`SELECT status FROM followup WHERE id = ?`).get(followupId);
  assert.equal(statusVal.status, 'done');
});

test('GET/POST /api/registrations allows viewing and updating registration status', async () => {
  raw.prepare(`INSERT INTO caregiver (id, first_name, email) VALUES ('cg_test_1', 'Maria', 'maria@example.org')`).run();
  raw.prepare(`INSERT INTO registration (caregiver_id, event_id, status, source, external_ref) VALUES ('cg_test_1', 'ev_memory_social_jul18', 'registered', 'test', 'ref_3')`).run();

  // GET with missing event_id
  const getFailRes = await getRegistrations({ request: new Request('http://localhost/api/registrations'), env });
  assert.equal(getFailRes.status, 400);

  // GET with event_id
  const getRes = await getRegistrations({
    request: new Request('http://localhost/api/registrations?event_id=ev_memory_social_jul18'),
    env
  });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.registrations.length, 1);
  assert.equal(getData.registrations[0].first_name, 'Maria');
  assert.equal(getData.registrations[0].status, 'registered');

  const regId = getData.registrations[0].id;

  // POST (update status)
  const req = new Request('http://localhost/api/registrations', {
    method: 'POST',
    body: JSON.stringify({ id: regId, status: 'attended' })
  });
  const postRes = await postRegistrations({ request: req, env });
  assert.equal(postRes.status, 200);

  const statusVal = raw.prepare(`SELECT status FROM registration WHERE id = ?`).get(regId);
  assert.equal(statusVal.status, 'attended');
});
