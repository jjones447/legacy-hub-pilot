import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getStaff, onRequestPost as postStaff } from '../functions/api/staff/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');

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

function mockRequest(urlStr, method = 'GET', body = null, headersObj = {}) {
  const normHeaders = {};
  for (const [k, v] of Object.entries(headersObj)) {
    normHeaders[k.toLowerCase()] = v;
  }
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      if (!body) throw new Error('no body');
      return body;
    },
    async text() {
      if (typeof body === 'string') return body;
      return JSON.stringify(body || {});
    }
  };
}

let raw;
let env;

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  env = { LEGACY_DB: d1(raw) };

  // Seed an open followup for testing
  raw.prepare(`
    INSERT OR IGNORE INTO followup (id, caregiver_id, kind, detail, status, source, external_ref)
    VALUES (1001, 'cg_seed_fictional', 'support_request', 'Need respite help', 'open', 'seed', 'ref_fu_001')
  `).run();
});

test('GET /api/staff/queue returns open followups with caregiver names', async () => {
  // Maria Gonzalez (cg_seed_fictional) is seeded with an open followup
  const req = mockRequest('http://localhost/api/staff/queue');
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(data.queue);
  assert.equal(data.queue.length, 1);
  assert.equal(data.queue[0].caregiver_first_name, 'Jane'); // cg_seed_fictional is Jane in 0003 seed
  assert.equal(data.queue[0].status, 'open');
});

test('GET /api/staff/caregiver/:id aggregates caregiver record data', async () => {
  const caregiverId = 'cg_seed_fictional';
  const req = mockRequest(`http://localhost/api/staff/caregiver/${caregiverId}`);
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.profile.id, caregiverId);
  assert.equal(data.profile.first_name, 'Jane');
  assert.ok(Array.isArray(data.registrations));
  assert.ok(Array.isArray(data.grants));
  assert.ok(Array.isArray(data.followups));
  assert.ok(Array.isArray(data.notes));
});

test('GET /api/staff/caregiver/:id returns 404 for unknown caregiver', async () => {
  const req = mockRequest('http://localhost/api/staff/caregiver/cg_unknown');
  const res = await getStaff({ request: req, env });
  assert.equal(res.status, 404);
});

test('POST /api/staff/followup/:id/resolve resolves followup with audit log and actor email', async () => {
  // Seed has followup id = 1001 (open)
  const req = mockRequest(
    'http://localhost/api/staff/followup/1001/resolve',
    'POST',
    { status: 'done' },
    { 'Cf-Access-Jwt-Assertion': 'header.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.signature' } // mock base64 email: staff@example.org
  );

  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);

  const fu = raw.prepare(`SELECT status FROM followup WHERE id = 1001`).get();
  assert.equal(fu.status, 'done');

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity_id = '1001'`).get();
  assert.ok(audit);
  assert.equal(audit.actor, 'staff@example.org');
  assert.equal(audit.action, 'followup.resolve');
});

test('POST /api/staff/followup/:id/resolve fails with 409 for already resolved followup', async () => {
  // Set followup 1001 to done first
  raw.prepare(`UPDATE followup SET status = 'done' WHERE id = 1001`).run();

  const req = mockRequest(
    'http://localhost/api/staff/followup/1001/resolve',
    'POST',
    { status: 'done' },
    { 'x-dev-actor': 'test_dev@example.org' }
  );

  const res = await postStaff({ request: req, env });
  assert.equal(res.status, 409);
});
