import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/webhooks/square.js';

const url = 'https://example.invalid/api/webhooks/square';
const key = 'synthetic-only-completion-status-key';

function request(type, status, { flat = false, outerStatus, badSignature = false,
  eventId = 'synthetic_event', paymentId = 'synthetic_payment' } = {}) {
  const payment = { id: paymentId, buyer_email_address: 'synthetic@example.invalid',
    amount_money: { amount: 100, currency: 'USD' } };
  if (status !== undefined) payment.status = status;
  const object = flat ? payment : { payment };
  if (!flat && outerStatus !== undefined) object.status = outerStatus;
  const body = JSON.stringify({ event_id: eventId, type, data: { object } });
  const signature = badSignature ? 'wrong-synthetic-signature'
    : createHmac('sha256', key).update(url + body).digest('base64');
  return new Request(url, { method: 'POST', body,
    headers: { 'x-square-hmacsha256-signature': signature } });
}

async function assertNoDatabase(type, status, options = {}, expectedStatus = 200, expectedBody = { ok: true, ignored: true }) {
  let accesses = 0;
  const env = { SQUARE_WEBHOOK_URL: url, SQUARE_WEBHOOK_SIGNATURE_KEY: key,
    get LEGACY_DB() { accesses++; throw new Error('refused/ignored payment must not access DB'); } };
  const response = await onRequestPost({ env, request: request(type, status, options) });
  assert.equal(response.status, expectedStatus);
  assert.deepEqual(await response.json(), expectedBody);
  assert.equal(accesses, 0);
}

for (const flat of [false, true]) {
  for (const status of ['FAILED', 'CANCELED', 'APPROVED', 'PENDING', '', null, false]) {
    test(`legacy completion ${flat ? 'flat' : 'nested'} explicit ${JSON.stringify(status)} is ignored before database`, async () => {
      await assertNoDatabase('payment.completed', status, { flat });
    });
  }
  for (const status of ['FAILED', 'CANCELED', 'APPROVED', 'PENDING', undefined, null, '']) {
    test(`updated ${flat ? 'flat' : 'nested'} ${JSON.stringify(status)} still requires COMPLETED`, async () => {
      await assertNoDatabase('payment.updated', status, { flat });
    });
  }
}

for (const type of ['payment.completed', 'payment.updated']) {
  test(`${type}: nested FAILED wins over outer COMPLETED`, async () => {
    await assertNoDatabase(type, 'FAILED', { outerStatus: 'COMPLETED' });
  });
  test(`${type}: missing nested status falls back to outer FAILED`, async () => {
    await assertNoDatabase(type, undefined, { outerStatus: 'FAILED' });
  });
  test(`${type}: HMAC authentication precedes noncompletion acknowledgement`, async () => {
    await assertNoDatabase(type, 'FAILED', { badSignature: true }, 401,
      { ok: false, error: 'invalid signature' });
  });
  test(`${type}: delivery ID validation still precedes noncompletion acknowledgement`, async () => {
    await assertNoDatabase(type, 'FAILED', { eventId: '' }, 400,
      { ok: false, error: 'missing event id' });
  });
  test(`${type}: ignored noncompletion does not require a payment ID`, async () => {
    await assertNoDatabase(type, 'FAILED', { paymentId: '' });
  });
  test(`${type}: accepted completion still requires a payment ID`, async () => {
    await assertNoDatabase(type, 'COMPLETED', { paymentId: '' }, 400,
      { ok: false, error: 'missing payment id' });
  });
}

test('legacy explicit null cannot be overridden by outer COMPLETED', async () => {
  await assertNoDatabase('payment.completed', null, { outerStatus: 'COMPLETED' });
});

for (const [name, type, status, options] of [
  ['legacy missing status', 'payment.completed', undefined, {}],
  ['legacy flat missing status', 'payment.completed', undefined, { flat: true }],
  ['legacy COMPLETED', 'payment.completed', 'COMPLETED', {}],
  ['legacy flat COMPLETED', 'payment.completed', 'COMPLETED', { flat: true }],
  ['updated COMPLETED', 'payment.updated', 'COMPLETED', {}],
  ['updated flat COMPLETED', 'payment.updated', 'COMPLETED', { flat: true }],
  ['legacy nested COMPLETED wins', 'payment.completed', 'COMPLETED', { outerStatus: 'FAILED' }],
  ['updated nested COMPLETED wins', 'payment.updated', 'COMPLETED', { outerStatus: 'FAILED' }],
  ['legacy outer COMPLETED fallback', 'payment.completed', undefined, { outerStatus: 'COMPLETED' }],
  ['updated outer COMPLETED fallback', 'payment.updated', undefined, { outerStatus: 'COMPLETED' }],
  ['updated existing empty-status fallback', 'payment.updated', '', { outerStatus: 'COMPLETED' }],
]) {
  test(`${name}: preserve one payment result, original audit and same-ID duplicate`, async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8'));
    const env = { SQUARE_WEBHOOK_URL: url, SQUARE_WEBHOOK_SIGNATURE_KEY: key,
      LEGACY_DB: {
        prepare(sql) {
          const bound = args => ({ sql, args, first: async () => db.prepare(sql).get(...args) ?? null });
          return { ...bound([]), bind: (...args) => bound(args) };
        },
        async batch(statements) {
          db.exec('BEGIN');
          try {
            const results = statements.map(({ sql, args }) => {
              const statement = db.prepare(sql);
              if (statement.columns().length) return { success: true, results: statement.all(...args) };
              statement.run(...args);
              return { success: true, results: [] };
            });
            db.exec('COMMIT');
            return results;
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        },
      },
    };
    try {
      const response = await onRequestPost({ env, request: request(type, status, options) });
      assert.equal(response.status, 200);
      const result = await response.json();
      const row = db.prepare('SELECT * FROM followup').get();
      assert.equal(result.entity_id, row.id);
      assert.equal(row.kind, 'donation_received');
      assert.equal(row.external_ref, 'payment:synthetic_payment');
      const audit = db.prepare('SELECT * FROM audit_log').get();
      assert.equal(audit.entity_id, String(row.id));
      assert.equal(audit.action, `webhook.${type}`);
      assert.equal(JSON.parse(audit.after_json).payment_id, 'synthetic_payment');
      const retry = await onRequestPost({ env, request: request(type, status, options) });
      assert.equal((await retry.json()).duplicate, true);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM followup').get().n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1);
    } finally { db.close(); }
  });
}
