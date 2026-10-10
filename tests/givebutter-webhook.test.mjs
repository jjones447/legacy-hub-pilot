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
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => {
          const statement = db.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...params), meta: {} };
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      return {
        sql, params: [],
        bind(...params) {
          return {
            sql, params,
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
    GIVEBUTTER_WEBHOOK_SIGNATURE_MODE: 'hmac_sha256', // Explicit legacy adapter fixtures.
    GIVEBUTTER_WEBHOOK_SECRET: WEBHOOK_SECRET
  };
});

// Provider-shaped fixtures use synthetic contacts and resource IDs only.
function providerPayload(event = 'transaction.succeeded', id = 'synthetic_resource_1') {
  return { event, data: { id, first_name: 'Synthetic', last_name: 'Fixture', email: 'fixture@example.invalid', amount: 1 } };
}

async function postProvider(payload, signature = WEBHOOK_SECRET, mode) {
  const providerEnv = { ...env };
  delete providerEnv.GIVEBUTTER_WEBHOOK_SIGNATURE_MODE;
  if (mode !== undefined) providerEnv.GIVEBUTTER_WEBHOOK_SIGNATURE_MODE = mode;
  return postGiveButter({
    request: mockRequest('https://example.invalid/api/webhooks/givebutter', 'POST', payload, { Signature: signature }),
    env: providerEnv
  });
}

test('documented secret signature and transaction data.id create a donation followup', async () => {
  const res = await postProvider(providerPayload());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entity, 'followup');
  const row = raw.prepare('SELECT kind, external_ref FROM followup').get();
  assert.equal(row.kind, 'donation');
  assert.equal(row.external_ref, 'transaction.succeeded:synthetic_resource_1');
});

test('documented ticket data.id without event mapping remains a registration followup', async () => {
  const payload = providerPayload('ticket.created');
  delete payload.data.amount;
  assert.equal((await postProvider(payload)).status, 200);
  const row = raw.prepare('SELECT kind, external_ref FROM followup').get();
  assert.equal(row.kind, 'gb_registration');
  assert.equal(row.external_ref, 'ticket.created:synthetic_resource_1');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM registration').get().n, 0);
});

test('provider-shaped sequential replay creates only one task and audit', async () => {
  const payload = providerPayload();
  assert.equal((await postProvider(payload)).status, 200);
  const replay = await postProvider(payload);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM followup').get().n, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 1);
});

test('transaction and ticket resource IDs cannot collide across event kinds', async () => {
  assert.equal((await postProvider(providerPayload())).status, 200);
  const ticket = providerPayload('ticket.created');
  delete ticket.data.amount;
  assert.equal((await postProvider(ticket)).status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM followup').get().n, 2);
});

test('documented secret mode is explicit and rejects HMAC rather than auto detecting', async () => {
  const payload = providerPayload();
  assert.equal((await postProvider(payload, WEBHOOK_SECRET, 'secret')).status, 200);
  const signature = computeSignature(JSON.stringify(payload), WEBHOOK_SECRET);
  assert.equal((await postProvider(payload, signature)).status, 401);
});

test('legacy HMAC mode rejects a bare secret and still binds the body', async () => {
  const payload = providerPayload();
  assert.equal((await postProvider(payload, WEBHOOK_SECRET, 'hmac_sha256')).status, 401);
  const signature = computeSignature(JSON.stringify(payload), WEBHOOK_SECRET);
  assert.equal((await postProvider(payload, signature, 'hmac_sha256')).status, 200);
  const changed = providerPayload('transaction.succeeded', 'another_resource');
  assert.equal((await postProvider(changed, signature, 'hmac_sha256')).status, 401);
});

test('unknown signature mode fails closed before database access', async () => {
  assert.equal((await postProvider(providerPayload(), WEBHOOK_SECRET, 'anything')).status, 503);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get().n, 0);
});

test('wrong documented secret fails closed before database access', async () => {
  assert.equal((await postProvider(providerPayload(), 'wrong-secret')).status, 401);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get().n, 0);
});

test('missing or malformed resource IDs fail before database access', async () => {
  for (const id of [undefined, null, '', {}, [], 'x'.repeat(201), -1, 1.5]) {
    const payload = providerPayload();
    payload.data.id = id;
    assert.equal((await postProvider(payload)).status, 400);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get().n, 0);
});

test('resource-ID fallback does not activate unrelated provider events', async () => {
  const response = await postProvider(providerPayload('contact.created'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ignored: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM caregiver').get().n, 0);
});

test('numeric resource IDs are normalized without changing explicit event IDs', async () => {
  assert.equal((await postProvider(providerPayload('transaction.succeeded', 42))).status, 200);
  const payload = { ...providerPayload('ticket.created'), id: 'original_delivery_id' };
  assert.equal((await postProvider(payload)).status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM followup WHERE external_ref IN ('transaction.succeeded:42', 'original_delivery_id')").get().n, 2);
});

test('non-object JSON bodies fail with 400 rather than internal error', async () => {
  for (const payload of ['string', [1, 2], 123]) {
    assert.equal((await postProvider(payload)).status, 400);
  }
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
