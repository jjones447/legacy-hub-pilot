import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { onRequestPost as postGiveButter } from '../functions/api/webhooks/givebutter.js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_2 = readFileSync(new URL('../schema/0002_seed_public_events.sql', import.meta.url), 'utf8');

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

function mockRequest(urlStr, method = 'POST', bodyObj = null, headersObj = {}) {
  const normHeaders = {};
  for (const [k, v] of Object.entries(headersObj)) {
    normHeaders[k.toLowerCase()] = v;
  }
  const bodyText = JSON.stringify(bodyObj || {});
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      return bodyObj || {};
    },
    async text() {
      return bodyText;
    }
  };
}

function computeSignature(payloadString, secret) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

let raw;
let env;
const WEBHOOK_SECRET = 'gb_test_secret_123';

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_2); // has public events: ev_morning_yoga, ev_support_group
  env = {
    LEGACY_DB: d1(raw),
    GIVEBUTTER_WEBHOOK_SECRET: WEBHOOK_SECRET
  };
});

test('GiveButter webhook rejects missing signature with 401', async () => {
  const req = mockRequest('http://localhost/api/webhooks/givebutter', 'POST', { id: 'evt_1' });
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 401);
});

test('GiveButter webhook rejects invalid signature with 401', async () => {
  const req = mockRequest(
    'http://localhost/api/webhooks/givebutter',
    'POST',
    { id: 'evt_1' },
    { 'Signature': 'wrong_sig_value' }
  );
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 401);
});

test('GiveButter webhook upserts caregiver and lands followup for donation (when not mapping to event)', async () => {
  const payload = {
    id: 'evt_donation_success',
    event: 'transaction.succeeded',
    data: {
      id: 'trans_gb_1',
      amount: '$100.00',
      campaign_name: 'Summer Wellness Drive',
      contact: {
        first_name: 'David',
        last_name: 'Miller',
        email: 'david@example.com',
        phone: '555-0199'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest(
    'http://localhost/api/webhooks/givebutter',
    'POST',
    payload,
    { 'Signature': signature }
  );

  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.entity, 'followup');

  // Verify caregiver upserted
  const cg = raw.prepare(`SELECT * FROM caregiver WHERE email = 'david@example.com'`).get();
  assert.ok(cg);
  assert.equal(cg.first_name, 'David');
  assert.equal(cg.last_name, 'Miller');

  // Verify followup created
  const fu = raw.prepare(`SELECT * FROM followup WHERE caregiver_id = ?`).get(cg.id);
  assert.ok(fu);
  assert.equal(fu.kind, 'donation');
  assert.equal(fu.detail, 'Givebutter donation: $100.00');
  assert.equal(fu.source, 'givebutter');
  assert.equal(fu.external_ref, 'evt_donation_success');

  // Verify audit log
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity_id = ?`).get(fu.id.toString());
  assert.ok(audit);
  assert.equal(audit.actor, 'givebutter_webhook');
  assert.equal(audit.action, 'webhook.transaction.succeeded');
});

test('GiveButter webhook lands event registration when campaign matches a published event ID', async () => {
  // Let's use event ID 'ev_virtual_support_group' (which exists and is published in SCHEMA_2)
  const payload = {
    id: 'evt_reg_success',
    event: 'ticket.created',
    data: {
      id: 'ticket_gb_1',
      event_id: 'ev_virtual_support_group',
      contact: {
        first_name: 'Sarah',
        last_name: 'Connor',
        email: 'sarah@example.com'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest(
    'http://localhost/api/webhooks/givebutter',
    'POST',
    payload,
    { 'Signature': signature }
  );

  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.entity, 'registration');

  const cg = raw.prepare(`SELECT id FROM caregiver WHERE email = 'sarah@example.com'`).get();
  assert.ok(cg);

  // Verify registration created
  const r = raw.prepare(`SELECT * FROM registration WHERE caregiver_id = ?`).get(cg.id);
  assert.ok(r);
  assert.equal(r.event_id, 'ev_virtual_support_group');
  assert.equal(r.source, 'givebutter');
  assert.equal(r.external_ref, 'evt_reg_success');
});

test('GiveButter webhook is idempotent on event replay', async () => {
  const payload = {
    id: 'evt_idempotency_test',
    event: 'transaction.succeeded',
    data: {
      id: 'trans_gb_2',
      amount: '$50.00',
      contact: {
        first_name: 'Arthur',
        last_name: 'Dent',
        email: 'arthur@example.com'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  // Send first time
  const req1 = mockRequest('http://localhost/api/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res1 = await postGiveButter({ request: req1, env });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.ok);
  assert.ok(!data1.duplicate);

  // Send second time
  const req2 = mockRequest('http://localhost/api/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res2 = await postGiveButter({ request: req2, env });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.ok);
  assert.equal(data2.duplicate, true);

  // Verify only one followup was actually created
  const count = raw.prepare(`SELECT COUNT(*) AS n FROM followup WHERE source = 'givebutter' AND external_ref = 'evt_idempotency_test'`).get();
  assert.equal(count.n, 1);
});
