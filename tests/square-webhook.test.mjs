import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { onRequestPost as postSquare } from '../functions/api/webhooks/square.js';

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
  const bodyText = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj || {});
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      return JSON.parse(bodyText);
    },
    async text() {
      return bodyText;
    }
  };
}

function computeSquareSignature(payloadString, notificationUrl, secret) {
  const message = notificationUrl + payloadString;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

let raw;
let env;
const WEBHOOK_SIGNATURE_KEY = 'sq_sigkey_test_secret_123';
const WEBHOOK_URL = 'https://example.org/api/webhooks/square';

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = OFF;');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_2);
  env = {
    LEGACY_DB: d1(raw),
    SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_SIGNATURE_KEY,
    SQUARE_WEBHOOK_URL: WEBHOOK_URL
  };
});

test('Square webhook returns 503 when webhook is not configured', async () => {
  const unconfiguredEnv = {
    LEGACY_DB: d1(raw)
  };
  const req = mockRequest(WEBHOOK_URL, 'POST', { event_id: 'evt_1' });
  const res = await postSquare({ request: req, env: unconfiguredEnv });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'webhook_not_configured');
});

test('Square webhook rejects missing signature with 401', async () => {
  const req = mockRequest(WEBHOOK_URL, 'POST', { event_id: 'evt_1' });
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'missing signature header');
});

test('Square webhook rejects invalid signature with 401', async () => {
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    { event_id: 'evt_1' },
    { 'x-square-hmacsha256-signature': 'wrong_sig_value' }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'invalid signature');
});

test('Square webhook rejects malformed JSON body with 400', async () => {
  const badBody = '{ invalid json here';
  const sig = computeSquareSignature(badBody, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    badBody,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'invalid JSON body');
});

test('Square webhook rejects missing event id with 400', async () => {
  const payload = { type: 'payment.completed' };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'missing event id');
});

test('Square webhook acknowledges non-payment event with 200 and no write', async () => {
  const payload = {
    event_id: 'evt_order_1',
    type: 'order.created',
    data: { id: 'ord_1' }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.ignored, true);

  const cgCount = raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get();
  const fuCount = raw.prepare('SELECT COUNT(*) AS n FROM followup').get();
  const auditCount = raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
  assert.equal(cgCount.n, 0);
  assert.equal(fuCount.n, 0);
  assert.equal(auditCount.n, 0);
});

test('Square webhook acknowledges payment.updated with non-COMPLETED status with 200 and no write', async () => {
  const payload = {
    event_id: 'evt_pay_pending',
    type: 'payment.updated',
    data: {
      object: {
        payment: {
          id: 'pay_pending_1',
          status: 'PENDING',
          buyer_email_address: 'pending@example.com'
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.ignored, true);

  const fuCount = raw.prepare('SELECT COUNT(*) AS n FROM followup').get();
  assert.equal(fuCount.n, 0);
});

test('Square webhook with good signature creates caregiver, followup, and audit log for donation', async () => {
  const payload = {
    event_id: 'evt_sq_donation_1',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_sq_100',
          status: 'COMPLETED',
          buyer_email_address: 'alice@example.com',
          buyer_name: 'Alice Springs',
          amount_money: {
            amount: 7500,
            currency: 'USD'
          }
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.entity, 'followup');

  // Verify caregiver
  const cg = raw.prepare('SELECT * FROM caregiver WHERE email = \'alice@example.com\'').get();
  assert.ok(cg);
  assert.equal(cg.first_name, 'Alice');
  assert.equal(cg.last_name, 'Springs');
  assert.equal(cg.source, 'square');
  assert.equal(cg.donor, 1);

  // Verify followup
  const fu = raw.prepare('SELECT * FROM followup WHERE caregiver_id = ?').get(cg.id);
  assert.ok(fu);
  assert.equal(fu.kind, 'donation_received');
  assert.equal(fu.detail, 'Square donation received: $75.00');
  assert.equal(fu.source, 'square');
  assert.equal(fu.external_ref, 'evt_sq_donation_1');

  // Verify audit log
  const audit = raw.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(fu.id.toString());
  assert.ok(audit);
  assert.equal(audit.actor, 'square_webhook');
  assert.equal(audit.action, 'webhook.payment.completed');
  assert.equal(audit.entity, 'followup');
});

test('Square webhook payment.updated with COMPLETED status creates caregiver and followup', async () => {
  const payload = {
    event_id: 'evt_sq_updated_completed',
    type: 'payment.updated',
    data: {
      object: {
        payment: {
          id: 'pay_sq_updated',
          status: 'COMPLETED',
          buyer_email_address: 'bob@example.com',
          amount_money: {
            amount: 5000,
            currency: 'USD'
          }
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.entity, 'followup');

  const cg = raw.prepare('SELECT * FROM caregiver WHERE email = \'bob@example.com\'').get();
  assert.ok(cg);
  const fu = raw.prepare('SELECT * FROM followup WHERE caregiver_id = ?').get(cg.id);
  assert.ok(fu);
  assert.equal(fu.kind, 'donation_received');
});

test('Square webhook lands event registration when order line item maps to a published event', async () => {
  // SCHEMA_2 seeds 'ev_virtual_support_group' with publish_state = 'published'
  const payload = {
    event_id: 'evt_sq_reg_1',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_sq_200',
          status: 'COMPLETED',
          buyer_email_address: 'charlie@example.com',
          order: {
            customer: {
              given_name: 'Charlie',
              family_name: 'Brown',
              email_address: 'charlie@example.com'
            },
            line_items: [
              {
                name: 'Virtual Support Group Ticket',
                catalog_object_id: 'ev_virtual_support_group',
                note: 'Registration for weekly group'
              }
            ]
          }
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.entity, 'registration');

  // Verify caregiver
  const cg = raw.prepare('SELECT * FROM caregiver WHERE email = \'charlie@example.com\'').get();
  assert.ok(cg);
  assert.equal(cg.first_name, 'Charlie');
  assert.equal(cg.last_name, 'Brown');

  // Verify registration
  const reg = raw.prepare('SELECT * FROM registration WHERE caregiver_id = ?').get(cg.id);
  assert.ok(reg);
  assert.equal(reg.event_id, 'ev_virtual_support_group');
  assert.equal(reg.source, 'square');
  assert.equal(reg.external_ref, 'evt_sq_reg_1');

  // Verify audit log
  const audit = raw.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(reg.id.toString());
  assert.ok(audit);
  assert.equal(audit.actor, 'square_webhook');
  assert.equal(audit.action, 'webhook.payment.completed');
  assert.equal(audit.entity, 'registration');
});

test('Square webhook lands event registration when line item note maps to published event', async () => {
  const payload = {
    event_id: 'evt_sq_reg_note',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_sq_201',
          status: 'COMPLETED',
          buyer_email_address: 'diana@example.com',
          line_items: [
            {
              name: 'Event Ticket',
              note: 'ev_virtual_support_group'
            }
          ]
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(
    WEBHOOK_URL,
    'POST',
    payload,
    { 'x-square-hmacsha256-signature': sig }
  );
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.entity, 'registration');

  const cg = raw.prepare('SELECT * FROM caregiver WHERE email = \'diana@example.com\'').get();
  assert.ok(cg);
  const reg = raw.prepare('SELECT * FROM registration WHERE caregiver_id = ?').get(cg.id);
  assert.ok(reg);
  assert.equal(reg.event_id, 'ev_virtual_support_group');
});

test('Square webhook is idempotent on event replay', async () => {
  const payload = {
    event_id: 'evt_sq_replay_test',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_sq_replay',
          status: 'COMPLETED',
          buyer_email_address: 'edward@example.com',
          amount_money: { amount: 3000, currency: 'USD' }
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);

  // First call
  const req1 = mockRequest(WEBHOOK_URL, 'POST', payload, { 'x-square-hmacsha256-signature': sig });
  const res1 = await postSquare({ request: req1, env });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.ok(!data1.duplicate);

  // Second call (replay)
  const req2 = mockRequest(WEBHOOK_URL, 'POST', payload, { 'x-square-hmacsha256-signature': sig });
  const res2 = await postSquare({ request: req2, env });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.duplicate, true);

  // Exactly one followup created
  const count = raw.prepare('SELECT COUNT(*) AS n FROM followup WHERE source = \'square\' AND external_ref = \'evt_sq_replay_test\'').get();
  assert.equal(count.n, 1);
});

test('Square webhook unmatched payment creates staff followup without caregiver row', async () => {
  const payload = {
    event_id: 'evt_sq_unmatched_1',
    type: 'payment.completed',
    data: {
      id: 'pay_sq_unmatched_id',
      object: {
        payment: {
          id: 'pay_sq_unmatched_id',
          status: 'COMPLETED',
          amount_money: { amount: 2500, currency: 'USD' }
          // No buyer_email_address or phone
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(WEBHOOK_URL, 'POST', payload, { 'x-square-hmacsha256-signature': sig });
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.unmatched, true);

  // Followup exists with kind payment_unmatched
  const fu = raw.prepare('SELECT * FROM followup WHERE kind = \'payment_unmatched\'').get();
  assert.ok(fu);
  assert.equal(fu.source, 'square');
  assert.equal(fu.external_ref, 'evt_sq_unmatched_1');
  assert.ok(fu.detail.includes('pay_sq_unmatched_id'));
  assert.ok(fu.detail.includes('evt_sq_unmatched_1'));

  // No caregiver created
  const cgCount = raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get();
  assert.equal(cgCount.n, 0);

  // Audit log exists
  const audit = raw.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(fu.id.toString());
  assert.ok(audit);
  assert.equal(audit.actor, 'square_webhook');
  assert.equal(audit.action, 'webhook.payment.completed');
});

test('Square webhook updates existing caregiver on matching email', async () => {
  // Pre-seed an existing caregiver
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, source)
    VALUES ('cg_pre_existing', 'Fiona', 'Gallagher', 'fiona@example.com', '555-0155', 'site_form')
  `).run();

  const payload = {
    event_id: 'evt_sq_existing_cg',
    type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'pay_sq_exist',
          status: 'COMPLETED',
          buyer_email_address: 'FIONA@EXAMPLE.COM', // test case-insensitivity
          amount_money: { amount: 10000, currency: 'USD' }
        }
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const sig = computeSquareSignature(payloadStr, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY);
  const req = mockRequest(WEBHOOK_URL, 'POST', payload, { 'x-square-hmacsha256-signature': sig });
  const res = await postSquare({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.caregiver_id, 'cg_pre_existing');

  // Verify only 1 caregiver exists
  const count = raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get();
  assert.equal(count.n, 1);

  // Followup attached to pre-existing caregiver
  const fu = raw.prepare('SELECT * FROM followup WHERE caregiver_id = \'cg_pre_existing\'').get();
  assert.ok(fu);
  assert.equal(fu.kind, 'donation_received');
  assert.equal(fu.detail, 'Square donation received: $100.00');
});
