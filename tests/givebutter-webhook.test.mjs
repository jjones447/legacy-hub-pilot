import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { onRequestPost as postGiveButter } from '../functions/webhooks/givebutter.js';
import { onRequestPost as postGiveButterApi } from '../functions/api/webhooks/givebutter.js';

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

function mockRequest(urlStr, method = 'POST', bodyObj = null, headersObj = {}, rawTextOverride = null) {
  const normHeaders = {};
  for (const [k, v] of Object.entries(headersObj)) {
    normHeaders[k.toLowerCase()] = v;
  }
  const bodyText = rawTextOverride !== null ? rawTextOverride : JSON.stringify(bodyObj || {});
  return {
    url: urlStr,
    method,
    headers: {
      get(name) {
        return normHeaders[name.toLowerCase()] || null;
      }
    },
    async json() {
      if (rawTextOverride !== null) return JSON.parse(rawTextOverride);
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
const WEBHOOK_SECRET = 'gb_fake_secret_fixture_123';

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_2); // has public events: ev_morning_yoga, ev_virtual_support_group
  env = {
    LEGACY_DB: d1(raw),
    GIVEBUTTER_WEBHOOK_SECRET: WEBHOOK_SECRET
  };
});

test('(a) a correctly signed event creates one record and one audit row', async () => {
  const payload = {
    id: 'evt_a_donation_001',
    event: 'transaction.succeeded',
    data: {
      id: 'trans_gb_001',
      amount: '$100.00',
      campaign_name: 'Caregiver Respite Drive',
      contact: {
        first_name: 'Alex',
        last_name: 'Taylor',
        email: 'alex.taylor@example.invalid',
        phone: '555-0101'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest(
    'https://legacy-hub.pages.dev/webhooks/givebutter',
    'POST',
    payload,
    { 'Signature': signature }
  );

  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.entity, 'followup');

  // Verify exactly one followup record created
  const followups = raw.prepare(`SELECT * FROM followup WHERE source = 'givebutter' AND external_ref = 'evt_a_donation_001'`).all();
  assert.equal(followups.length, 1);
  assert.equal(followups[0].kind, 'donation');
  assert.equal(followups[0].detail, 'Givebutter donation: $100.00');

  // Verify exactly one audit row created
  const auditLogs = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'followup' AND entity_id = ?`).all(followups[0].id.toString());
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].actor, 'givebutter_webhook');
  assert.equal(auditLogs[0].action, 'webhook.transaction.succeeded');
});

test('(b) the identical event replayed creates nothing further and still returns 200', async () => {
  const payload = {
    id: 'evt_b_replay_002',
    event: 'transaction.succeeded',
    data: {
      id: 'trans_gb_002',
      amount: '$75.00',
      contact: {
        first_name: 'Jordan',
        last_name: 'Lee',
        email: 'jordan.lee@example.invalid'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  // First request
  const req1 = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res1 = await postGiveButter({ request: req1, env });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.ok);
  assert.ok(!data1.duplicate);

  const initialFollowups = raw.prepare(`SELECT COUNT(*) AS c FROM followup WHERE source = 'givebutter' AND external_ref = 'evt_b_replay_002'`).get();
  const initialAudit = raw.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE actor = 'givebutter_webhook'`).get();
  assert.equal(initialFollowups.c, 1);
  assert.equal(initialAudit.c, 1);

  // Second request (replay)
  const req2 = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res2 = await postGiveButter({ request: req2, env });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.ok);
  assert.equal(data2.duplicate, true);

  // Verify counts unchanged
  const replayFollowups = raw.prepare(`SELECT COUNT(*) AS c FROM followup WHERE source = 'givebutter' AND external_ref = 'evt_b_replay_002'`).get();
  const replayAudit = raw.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE actor = 'givebutter_webhook'`).get();
  assert.equal(replayFollowups.c, 1);
  assert.equal(replayAudit.c, 1);
});

test('(c) a bad signature returns 401 and writes nothing', async () => {
  const initialCaregivers = raw.prepare(`SELECT COUNT(*) AS c FROM caregiver`).get().c;
  const initialFollowups = raw.prepare(`SELECT COUNT(*) AS c FROM followup`).get().c;
  const initialAudit = raw.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get().c;

  const payload = {
    id: 'evt_c_badsig_003',
    event: 'transaction.succeeded',
    data: {
      amount: '$500.00',
      contact: {
        first_name: 'Malicious',
        last_name: 'Actor',
        email: 'attacker@example.invalid'
      }
    }
  };

  const req = mockRequest(
    'https://legacy-hub.pages.dev/webhooks/givebutter',
    'POST',
    payload,
    { 'Signature': 'bad_signature_hex_digest_deadbeef' }
  );

  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.ok, false);

  // Assert nothing was written
  assert.equal(raw.prepare(`SELECT COUNT(*) AS c FROM caregiver`).get().c, initialCaregivers);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS c FROM followup`).get().c, initialFollowups);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get().c, initialAudit);
});

test('(d) an unparsable body returns 400', async () => {
  const malformedText = '{"event": "transaction", broken_json_syntax...';
  const signature = computeSignature(malformedText, WEBHOOK_SECRET);

  const req = mockRequest(
    'https://legacy-hub.pages.dev/webhooks/givebutter',
    'POST',
    null,
    { 'Signature': signature },
    malformedText
  );

  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid JSON body');

  // Verify payload is not echoed back in error response
  assert.ok(!JSON.stringify(body).includes('broken_json_syntax'));
});

test('(e) a donation from an unknown email creates a contact-only record', async () => {
  const payload = {
    id: 'evt_e_unknown_005',
    event: 'transaction.succeeded',
    data: {
      amount: '$25.00',
      contact: {
        first_name: 'Morgan',
        last_name: 'Rivera',
        email: 'morgan.rivera@example.invalid',
        phone: '555-0155'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  // Verify email does not exist yet
  assert.equal(raw.prepare(`SELECT id FROM caregiver WHERE email = 'morgan.rivera@example.invalid'`).get(), undefined);

  const req = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  const cg = raw.prepare(`SELECT * FROM caregiver WHERE email = 'morgan.rivera@example.invalid'`).get();
  assert.ok(cg);
  assert.equal(cg.first_name, 'Morgan');
  assert.equal(cg.last_name, 'Rivera');
  assert.equal(cg.source, 'givebutter');
  assert.equal(cg.donor, 1);
  assert.equal(cg.sanctuary_member, 0); // contact-only, not sanctuary member
});

test('(f) a donation from a known email attaches to the existing record', async () => {
  // Seed an existing caregiver record
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, source, donor, sanctuary_member)
    VALUES ('cg_preexisting_123', 'Casey', 'Stone', 'casey.stone@example.invalid', '555-0188', 'site_form', 0, 1)
  `).run();

  const preCount = raw.prepare(`SELECT COUNT(*) AS c FROM caregiver`).get().c;

  // Donation arrives with mixed-case and whitespace in email
  const payload = {
    id: 'evt_f_known_006',
    event: 'transaction.succeeded',
    data: {
      amount: '$150.00',
      contact: {
        first_name: 'Casey',
        last_name: 'Stone',
        email: '  CASEY.STONE@EXAMPLE.INVALID  ',
        phone: '555-0188'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  // Caregiver table count must NOT increase (no duplicate created)
  const postCount = raw.prepare(`SELECT COUNT(*) AS c FROM caregiver`).get().c;
  assert.equal(postCount, preCount);

  // Followup attached to the existing caregiver
  const fu = raw.prepare(`SELECT * FROM followup WHERE source = 'givebutter' AND external_ref = 'evt_f_known_006'`).get();
  assert.ok(fu);
  assert.equal(fu.caregiver_id, 'cg_preexisting_123');
  assert.equal(fu.kind, 'donation');

  // Existing caregiver updated with donor = 1
  const updatedCg = raw.prepare(`SELECT * FROM caregiver WHERE id = 'cg_preexisting_123'`).get();
  assert.equal(updatedCg.donor, 1);
  assert.equal(updatedCg.sanctuary_member, 1); // preserved existing fields
});

test('GiveButter webhook rejects missing signature header with 401', async () => {
  const req = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', { id: 'evt_nosig_007' });
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 401);
});

test('GiveButter webhook rejects when GIVEBUTTER_WEBHOOK_SECRET is absent with 401', async () => {
  const envNoSecret = { LEGACY_DB: env.LEGACY_DB };
  const req = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', { id: 'evt_nosecret_008' }, { 'Signature': 'some_sig' });
  const res = await postGiveButter({ request: req, env: envNoSecret });
  assert.equal(res.status, 401);
});

test('GiveButter webhook lands event registration when campaign matches a published event ID', async () => {
  const payload = {
    id: 'evt_reg_success_009',
    event: 'ticket.created',
    data: {
      id: 'ticket_gb_009',
      event_id: 'ev_virtual_support_group',
      contact: {
        first_name: 'Robin',
        last_name: 'Banks',
        email: 'robin.banks@example.invalid'
      }
    }
  };

  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest('https://legacy-hub.pages.dev/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res = await postGiveButter({ request: req, env });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.entity, 'registration');

  const cg = raw.prepare(`SELECT id FROM caregiver WHERE email = 'robin.banks@example.invalid'`).get();
  assert.ok(cg);

  const r = raw.prepare(`SELECT * FROM registration WHERE caregiver_id = ?`).get(cg.id);
  assert.ok(r);
  assert.equal(r.event_id, 'ev_virtual_support_group');
  assert.equal(r.source, 'givebutter');
  assert.equal(r.external_ref, 'evt_reg_success_009');
});

test('api alias re-export matches functions/webhooks/givebutter.js behavior', async () => {
  const payload = {
    id: 'evt_alias_010',
    event: 'transaction.succeeded',
    data: {
      amount: '$10.00',
      contact: {
        email: 'alias.test@example.invalid'
      }
    }
  };
  const payloadStr = JSON.stringify(payload);
  const signature = computeSignature(payloadStr, WEBHOOK_SECRET);

  const req = mockRequest('https://legacy-hub.pages.dev/api/webhooks/givebutter', 'POST', payload, { 'Signature': signature });
  const res = await postGiveButterApi({ request: req, env });
  assert.equal(res.status, 200);
});
