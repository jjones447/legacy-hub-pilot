import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/webhooks/square.js';

const url = 'https://example.invalid/api/webhooks/square';
const key = 'synthetic-only-signature-key';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_init.sql', '0002_seed_public_events.sql']) {
    db.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), 'utf8'));
  }
  let accesses = 0;
  const env = {
    SQUARE_WEBHOOK_URL: url, SQUARE_WEBHOOK_SIGNATURE_KEY: key,
    LEGACY_DB: { async batch(statements) {
      accesses++;
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, args }) => {
          const statement = db.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...args), meta: {} };
          const result = statement.run(...args);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }, prepare(sql) {
      accesses++;
      const statement = db.prepare(sql);
      const bound = (args) => ({
        sql, args,
        first: async () => statement.get(...args) ?? null,
        run: async () => statement.run(...args),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    } },
  };
  async function deliver(eventId, paymentId = 'synthetic_payment', extra = {}, signatureUrl = url) {
    const body = JSON.stringify({ event_id: eventId, type: 'payment.updated',
      data: { object: { payment: { id: paymentId, status: 'COMPLETED',
        amount_money: { amount: 5000, currency: 'USD' }, ...extra } } } });
    const signature = createHmac('sha256', key).update(signatureUrl + body).digest('base64');
    const response = await onRequestPost({ env, request: new Request(url, {
      method: 'POST', headers: { 'x-square-hmacsha256-signature': signature }, body,
    }) });
    return { status: response.status, body: await response.json() };
  }
  return { db, deliver, accesses: () => accesses };
}

for (const [name, extra, table] of [
  ['donation', { buyer_email_address: 'synthetic@example.invalid' }, 'followup'],
  ['unmatched', {}, 'followup'],
  ['registration', { buyer_email_address: 'synthetic@example.invalid', note: 'ev_virtual_support_group' }, 'registration'],
]) {
  test(`different updates for one completed ${name} payment create one record and audit`, async () => {
    const f = fixture();
    try {
      assert.equal((await f.deliver('synthetic_paid', 'synthetic_payment', extra)).status, 200);
      const fee = await f.deliver('synthetic_fee', 'synthetic_payment', {
        ...extra, processing_fee: [{ amount_money: { amount: 100, currency: 'USD' } }],
      });
      assert.equal(fee.status, 200);
      assert.equal(fee.body.duplicate, true);
      assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE source='square'`).get().n, 1);
      assert.equal(f.db.prepare("SELECT count(*) n FROM audit_log WHERE actor='square_webhook'").get().n, 1);
      const audit = JSON.parse(f.db.prepare("SELECT after_json FROM audit_log WHERE actor='square_webhook'").get().after_json);
      assert.equal(audit.payment_id, 'synthetic_payment');
      assert.equal(audit.event_id, 'synthetic_paid');
    } finally { f.db.close(); }
  });
}

test('two different payments remain distinct', async () => {
  const f = fixture();
  try {
    await f.deliver('synthetic_a', 'payment_a');
    await f.deliver('synthetic_b', 'payment_b');
    assert.equal(f.db.prepare("SELECT count(*) n FROM followup WHERE source='square'").get().n, 2);
  } finally { f.db.close(); }
});

for (const badId of [undefined, null, '', 7, {}, '   ']) {
  test(`malformed completed payment id ${JSON.stringify(badId)} refuses before database`, async () => {
    const f = fixture();
    try {
      assert.equal((await f.deliver('synthetic_bad', 'placeholder', { id: badId })).status, 400);
      assert.equal(f.accesses(), 0);
    } finally { f.db.close(); }
  });
}

test('configured notification URL is part of signature authentication', async () => {
  const f = fixture();
  try {
    assert.equal((await f.deliver('synthetic_bad_url', 'synthetic_payment', {}, url + '/wrong')).status, 401);
    assert.equal(f.accesses(), 0);
  } finally { f.db.close(); }
});

test('same-event legacy record retry preserves existing row and audit', async () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO caregiver (id,first_name,last_name,source) VALUES ('synthetic_legacy','Old','Fixture','square')").run();
    f.db.prepare("INSERT INTO followup (caregiver_id,kind,source,external_ref) VALUES ('synthetic_legacy','donation_received','square','legacy_event')").run();
    const result = await f.deliver('legacy_event', 'legacy_payment');
    assert.equal(result.body.duplicate, true);
    assert.equal(f.db.prepare("SELECT count(*) n FROM followup").get().n, 1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM audit_log").get().n, 0);
    assert.equal(f.db.prepare('SELECT external_ref FROM followup').get().external_ref, 'legacy_event');
  } finally { f.db.close(); }
});
