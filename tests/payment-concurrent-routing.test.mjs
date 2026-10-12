import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { onRequestPost as square } from '../functions/api/webhooks/square.js';
import { onRequestPost as givebutter } from '../functions/api/webhooks/givebutter.js';

// Deliberately interleave pre-batch reads, then serialize SQLite transactions.
// No network, subprocess, file database, workerd or provider credential.
function fixture(provider, { existing = true, applyGuard = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_init.sql', '0002_seed_public_events.sql']) {
    db.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), 'utf8'));
  }
  const guard = new URL('../schema/0014_payment_result_guard.sql', import.meta.url);
  if (applyGuard) db.exec(readFileSync(guard, 'utf8'));
  if (existing) db.exec(`INSERT INTO caregiver (id, first_name, email, source, updated_at)
    VALUES ('cg_race', 'Synthetic', 'race@example.invalid', 'fixture', '2000-01-01 00:00:00')`);
  let waiting = 0;
  let release;
  const bothReady = new Promise(resolve => { release = resolve; });
  let gating = true;
  const adapter = {
    prepare(sql) {
      const bind = args => ({ sql, args, first: async () => db.prepare(sql).get(...args) ?? null });
      return { ...bind([]), bind: (...args) => bind(args) };
    },
    async batch(statements) {
      if (gating) { if (++waiting === 2) release(); await bothReady; }
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
  };
  const url = `https://example.invalid/api/webhooks/${provider}`;
  const key = 'synthetic-race-key';
  const env = { LEGACY_DB: adapter, SQUARE_WEBHOOK_URL: url, SQUARE_WEBHOOK_SIGNATURE_KEY: key,
    GIVEBUTTER_WEBHOOK_SECRET: key };
  const deliver = async (mapped, ordinal) => {
    const email = existing ? 'race@example.invalid' : `race${ordinal}@example.invalid`;
    const payload = provider === 'square'
      ? { event_id: `delivery_${ordinal}`, type: 'payment.updated', data: { object: { payment: {
        id: 'same_payment', status: 'COMPLETED', buyer_email_address: email,
        ...(mapped ? { note: 'ev_virtual_support_group' } : {}), amount_money: { amount: 100, currency: 'USD' },
      } } } }
      : { event: 'transaction.succeeded', data: { id: 'same_transaction', email,
        ...(mapped ? { campaign_id: 'ev_virtual_support_group' } : {}), amount: 1 } };
    const body = JSON.stringify(payload);
    const headers = provider === 'square'
      ? { 'x-square-hmacsha256-signature': createHmac('sha256', key).update(url + body).digest('base64') }
      : { Signature: key };
    return (provider === 'square' ? square : givebutter)({ env,
      request: new Request(url, { method: 'POST', headers, body }) });
  };
  const snapshot = () => ({
    caregivers: db.prepare('SELECT * FROM caregiver ORDER BY id').all(),
    registrations: db.prepare('SELECT * FROM registration').all(),
    followups: db.prepare('SELECT * FROM followup').all(),
    audits: db.prepare('SELECT * FROM audit_log').all(),
  });
  return { db, deliver, snapshot, stopGate: () => { gating = false; } };
}

for (const provider of ['square', 'givebutter']) {
  test(`${provider}: pre-migration cross-table schedule demonstrates two effects`, async () => {
    const f = fixture(provider, { applyGuard: false });
    try {
      const responses = await Promise.all([f.deliver(false, 0), f.deliver(true, 1)]);
      assert.deepEqual(responses.map(r => r.status), [200, 200]);
      assert.equal(f.snapshot().registrations.length + f.snapshot().followups.length, 2);
      assert.equal(f.snapshot().audits.length, 2);
    } finally { f.db.close(); }
  });
  for (const existing of [false, true]) {
  for (const routes of [[false, false], [true, true], [false, true], [true, false]]) {
    test(`${provider}: ${existing ? 'existing' : 'new'} caregiver concurrent routes ${routes} commit one original result/audit`, async () => {
      const f = fixture(provider, { existing });
      const originalLog = console.error;
      console.error = () => {}; // Expected synthetic UNIQUE/trigger failure only.
      try {
        const responses = await Promise.all(routes.map((mapped, i) => f.deliver(mapped, i)));
        const committed = f.snapshot();
        assert.equal(committed.followups.length + committed.registrations.length, 1);
        assert.equal(committed.audits.length, 1);
        assert.equal(committed.caregivers.length, 1, 'losing caregiver insert rolls back');
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 500]);
        const result = [...committed.followups, ...committed.registrations][0];
        assert.equal(committed.audits[0].entity_id, String(result.id));
        assert.equal(committed.audits[0].actor, `${provider}_webhook`);
        assert.equal(JSON.parse(committed.audits[0].after_json).external_ref, result.external_ref);
        f.stopGate();
        for (const mapped of [false, true]) {
          const retry = await f.deliver(mapped, 3);
          assert.equal(retry.status, 200);
          assert.equal((await retry.json()).duplicate, true);
          assert.deepEqual(f.snapshot(), committed);
        }
      } finally { console.error = originalLog; f.db.close(); }
    });
  }
  }
}

test('guards preserve history, unrelated sources, separate providers and normal status updates', () => {
  const f = fixture('square', { applyGuard: false });
  try {
    f.db.exec(`INSERT INTO followup (caregiver_id, kind, source, external_ref)
      VALUES ('cg_race', 'historical', 'square', 'historical');
      INSERT INTO registration (caregiver_id, event_id, source, external_ref)
      VALUES ('cg_race', 'ev_virtual_support_group', 'square', 'historical');`);
    const before = f.snapshot();
    const guard = readFileSync(new URL('../schema/0014_payment_result_guard.sql', import.meta.url), 'utf8');
    f.db.exec(guard);
    f.db.exec(guard);
    assert.deepEqual(f.snapshot(), before);
    f.db.exec("UPDATE followup SET status='done' WHERE external_ref='historical'");
    for (const provider of ['square', 'givebutter']) {
      f.db.prepare(`INSERT INTO followup (caregiver_id, kind, source, external_ref)
        VALUES ('cg_race', 'synthetic', ?, 'same_ref')`).run(provider);
      assert.throws(() => f.db.prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref)
        VALUES ('cg_race', 'ev_virtual_support_group', ?, 'same_ref')`).run(provider), /already committed/);
      f.db.prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref)
        VALUES ('cg_race', 'ev_virtual_support_group', ?, 'new_ref')`).run(provider);
      assert.throws(() => f.db.prepare("UPDATE registration SET external_ref='same_ref' WHERE source=? AND external_ref='new_ref'")
        .run(provider), /already committed/);
      assert.throws(() => f.db.prepare("UPDATE followup SET external_ref='new_ref' WHERE source=? AND external_ref='same_ref'")
        .run(provider), /already committed/);
    }
    f.db.exec(`INSERT INTO followup (caregiver_id, kind, source, external_ref)
      VALUES ('cg_race', 'synthetic', 'fixture', 'same_ref');
      INSERT INTO registration (caregiver_id, event_id, source, external_ref)
      VALUES ('cg_race', 'ev_virtual_support_group', 'fixture', 'same_ref');`);
  } finally { f.db.close(); }
});
