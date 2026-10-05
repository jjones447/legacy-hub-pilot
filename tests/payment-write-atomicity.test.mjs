import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { onRequestPost as square } from '../functions/api/webhooks/square.js';
import { onRequestPost as givebutter } from '../functions/api/webhooks/givebutter.js';

// Synthetic SQLite transaction adapter, not Cloudflare D1/workerd acceptance.
const cases = [
  ['square', 'unmatched', 'followup'],
  ['square', 'donation', 'followup'],
  ['square', 'registration', 'registration'],
  ['givebutter', 'donation', 'followup'],
  ['givebutter', 'registration', 'registration'],
];
const key = 'synthetic-only-atomicity-key';
const email = 'atomicity@example.invalid';

function fixture(provider, branch, { existing = false, auditFault = false, noRowId = false, transformBatch } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_init.sql', '0002_seed_public_events.sql']) {
    db.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), 'utf8'));
  }
  if (existing) {
    const id = branch === 'unmatched' ? 'cg_unmatched_square' : 'cg_existing_synthetic';
    db.prepare(`INSERT INTO caregiver (id, first_name, email, source, status, updated_at)
      VALUES (?, 'Synthetic', ?, 'fixture', ?, '2000-01-01 00:00:00')`)
      .run(id, branch === 'unmatched' ? null : email, branch === 'unmatched' ? 'inactive' : 'active');
  }
  // Nontrivial existing result/audit IDs catch accidentally using an audit row ID.
  db.prepare(`INSERT INTO caregiver (id, first_name, source) VALUES ('cg_other_synthetic', 'Other', 'fixture')`).run();
  db.prepare(`INSERT INTO followup (id, caregiver_id, kind, source, external_ref)
    VALUES (37, 'cg_other_synthetic', 'fixture', 'fixture', 'unrelated')`).run();
  db.prepare(`INSERT INTO registration (id, caregiver_id, event_id, source, external_ref)
    VALUES (41, 'cg_other_synthetic', 'ev_virtual_support_group', 'fixture', 'unrelated')`).run();
  db.prepare(`INSERT INTO audit_log (id, actor, action, entity, entity_id)
    VALUES (89, 'fixture', 'fixture', 'fixture', 'unrelated')`).run();
  if (auditFault) db.exec(`CREATE TRIGGER synthetic_audit_fault BEFORE INSERT ON audit_log
    BEGIN SELECT RAISE(ABORT, 'synthetic audit-write fault'); END;`);
  let batches = 0;
  const adapter = {
    prepare(sql) {
      if (noRowId && /last_insert_rowid\s*\(/i.test(sql)) throw new Error('standalone row ID must not be used');
      const statement = db.prepare(sql);
      const bound = args => ({
        sql, args,
        first: async () => statement.get(...args) ?? null,
        run: async () => statement.run(...args),
        all: async () => ({ results: statement.all(...args) }),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
    async batch(statements) {
      batches++;
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, args }) => {
          const statement = db.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...args), meta: {} };
          const result = statement.run(...args);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec('COMMIT');
        return transformBatch ? transformBatch(results) : results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const url = `https://example.invalid/api/webhooks/${provider}`;
  const env = { LEGACY_DB: adapter, SQUARE_WEBHOOK_URL: url, SQUARE_WEBHOOK_SIGNATURE_KEY: key,
    GIVEBUTTER_WEBHOOK_SECRET: key };
  const payment = { id: 'synthetic_payment', status: 'COMPLETED', amount_money: { amount: 100, currency: 'USD' } };
  if (branch !== 'unmatched') payment.buyer_email_address = email;
  if (branch === 'registration') payment.note = 'ev_virtual_support_group';
  const data = { id: 'synthetic_resource', email, first_name: 'Synthetic', last_name: 'Fixture' };
  if (branch === 'registration') data.event_id = 'ev_virtual_support_group';
  else data.amount = 1;
  const body = JSON.stringify(provider === 'square'
    ? { event_id: 'synthetic_delivery', type: 'payment.updated', data: { object: { payment } } }
    : { event: branch === 'registration' ? 'ticket.created' : 'transaction.succeeded', data });
  const headers = provider === 'square'
    ? { 'x-square-hmacsha256-signature': createHmac('sha256', key).update(url + body).digest('base64') }
    : { Signature: key };
  const deliver = () => (provider === 'square' ? square : givebutter)({ env,
    request: new Request(url, { method: 'POST', headers, body }) });
  const snapshot = () => ({
    caregivers: db.prepare('SELECT * FROM caregiver ORDER BY id').all(),
    followups: db.prepare('SELECT * FROM followup ORDER BY id').all(),
    registrations: db.prepare('SELECT * FROM registration ORDER BY id').all(),
    audits: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  });
  return { db, deliver, snapshot, batches: () => batches };
}

async function withoutExpectedErrorLog(run) {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
}

function verifyOriginal(f, provider, branch, table, response) {
  const row = f.db.prepare(`SELECT * FROM ${table} WHERE source=?`).get(provider);
  assert.ok(row);
  assert.equal(response.entity, table);
  assert.equal(response.entity_id, row.id);
  assert.equal(row.external_ref, provider === 'square' ? 'payment:synthetic_payment'
    : `${branch === 'registration' ? 'ticket.created' : 'transaction.succeeded'}:synthetic_resource`);
  const audit = f.db.prepare('SELECT * FROM audit_log WHERE actor=?').get(`${provider}_webhook`);
  assert.ok(audit);
  assert.equal(audit.entity, table);
  assert.equal(audit.entity_id, String(row.id));
  assert.notEqual(Number(audit.entity_id), audit.id);
  assert.equal(audit.action, `webhook.${provider === 'square' ? 'payment.updated'
    : branch === 'registration' ? 'ticket.created' : 'transaction.succeeded'}`);
  const detail = JSON.parse(audit.after_json);
  assert.equal(detail.external_ref, row.external_ref);
  if (branch === 'unmatched') assert.equal(row.caregiver_id, 'cg_unmatched_square');
  else {
    assert.equal(detail.caregiver_id, row.caregiver_id);
    assert.equal(f.db.prepare('SELECT email FROM caregiver WHERE id=?').get(row.caregiver_id).email, email);
  }
  if (branch === 'registration') assert.equal(row.event_id, 'ev_virtual_support_group');
  if (provider === 'square') {
    assert.equal(detail.payment_id, 'synthetic_payment');
    assert.equal(detail.event_id, 'synthetic_delivery');
  }
  assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE source=?`).get(provider).n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM audit_log WHERE actor=?').get(`${provider}_webhook`).n, 1);
}

for (const [provider, branch, table] of cases) {
  for (const existing of [false, true]) {
    test(`${provider} ${branch}: audit failure rolls back ${existing ? 'existing' : 'new'} caregiver and result; healthy retry writes original audit`, async () => {
      const f = fixture(provider, branch, { existing, auditFault: true });
      try {
        const before = f.snapshot();
        const failed = await withoutExpectedErrorLog(f.deliver);
        assert.equal(failed.status, 500);
        assert.deepEqual(await failed.json(), { ok: false, error: 'internal_error' });
        assert.deepEqual(f.snapshot(), before, 'entire caregiver/result/audit mutation must roll back');
        f.db.exec('DROP TRIGGER synthetic_audit_fault');
        const success = await f.deliver();
        assert.equal(success.status, 200);
        verifyOriginal(f, provider, branch, table, await success.json());
        assert.equal(f.batches(), 2, 'each delivery must use one transaction');
        const afterSuccess = f.snapshot();
        const duplicate = await f.deliver();
        assert.equal(duplicate.status, 200);
        assert.equal((await duplicate.json()).duplicate, true);
        assert.deepEqual(f.snapshot(), afterSuccess);
        assert.equal(f.batches(), 2, 'duplicate must not start a new write transaction');
      } finally { f.db.close(); }
    });
  }
  test(`${provider} ${branch}: stable result/audit identity never reads standalone last_insert_rowid`, async () => {
    const f = fixture(provider, branch, { noRowId: true });
    try {
      const response = await f.deliver();
      assert.equal(response.status, 200);
      verifyOriginal(f, provider, branch, table, await response.json());
      assert.equal(f.batches(), 1);
    } finally { f.db.close(); }
  });
  test(`${provider} ${branch}: result insert failure rolls back caregiver mutation`, async () => {
    const f = fixture(provider, branch, { existing: true });
    try {
      const before = f.snapshot();
      f.db.exec(`CREATE TRIGGER synthetic_result_fault BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'synthetic result-write fault'); END;`);
      const response = await withoutExpectedErrorLog(f.deliver);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.batches(), 1);
    } finally { f.db.close(); }
  });
}

for (const provider of ['square', 'givebutter']) {
  for (const [name, transformBatch] of [
    ['absent', () => undefined],
    ['sparse array', rows => { delete rows[1]; return rows; }],
    ['missing final rows', rows => rows.map((row, index) => index === rows.length - 1 ? { success: true, results: [] } : row)],
    ['ambiguous final rows', rows => rows.map((row, index) => index === rows.length - 1 ? { ...row, results: [row.results[0], row.results[0]] } : row)],
    ['unsuccessful statement', rows => rows.map((row, index) => index === 1 ? { ...row, success: false } : row)],
    ['malformed result id', rows => rows.map((row, index) => index === rows.length - 1 ? { ...row, results: [{ id: 'wrong' }] } : row)],
  ]) {
    test(`${provider}: ${name} batch response is generic failure, never false success`, async () => {
      const f = fixture(provider, 'donation', { transformBatch });
      try {
        const response = await withoutExpectedErrorLog(f.deliver);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
        // The simulated response corruption occurs after commit: retry must keep
        // the original complete result/audit, not duplicate or repair anything.
        assert.equal(f.db.prepare('SELECT count(*) n FROM followup WHERE source=?').get(provider).n, 1);
        assert.equal(f.db.prepare('SELECT count(*) n FROM audit_log WHERE actor=?').get(`${provider}_webhook`).n, 1);
        const committed = f.snapshot();
        const retry = await f.deliver();
        assert.equal(retry.status, 200);
        assert.equal((await retry.json()).duplicate, true);
        assert.deepEqual(f.snapshot(), committed);
        assert.equal(f.batches(), 1);
      } finally { f.db.close(); }
    });
  }
  test(`${provider}: historical partial result remains unchanged with no audit backfill`, async () => {
    const f = fixture(provider, 'donation', { existing: true });
    try {
      const reference = provider === 'square' ? 'payment:synthetic_payment' : 'transaction.succeeded:synthetic_resource';
      f.db.prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
        VALUES ('cg_existing_synthetic', 'historical', 'Preserve original detail', ?, ?)`)
        .run(provider, reference);
      const before = f.snapshot();
      const response = await f.deliver();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).duplicate, true);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.batches(), 0);
    } finally { f.db.close(); }
  });
}
