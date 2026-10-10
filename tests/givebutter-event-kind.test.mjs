import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/webhooks/givebutter.js';

const secret = 'synthetic-only-event-kind-secret';

function request(payload, mode, invalidSignature = false) {
  const body = JSON.stringify(payload);
  const signature = invalidSignature ? 'wrong-synthetic-signature'
    : mode === 'hmac_sha256' ? createHmac('sha256', secret).update(body).digest('hex') : secret;
  return new Request('https://example.invalid/api/webhooks/givebutter', {
    method: 'POST', headers: { Signature: signature }, body,
  });
}

function payload(event, explicitId) {
  return {
    ...(explicitId ? { id: 'synthetic_delivery' } : {}), event,
    data: { id: 'synthetic_resource', first_name: 'Synthetic', last_name: 'Fixture',
      email: 'synthetic@example.invalid', amount: 50 },
  };
}

for (const mode of ['secret', 'hmac_sha256']) {
  for (const event of ['plan.failed', 'plan.canceled', 'plan.created', 'contact.created', 'unknown.synthetic']) {
    for (const explicitId of [false, true]) {
      test(`${mode}: ${event} ${explicitId ? 'explicit delivery ID' : 'resource ID'} cannot enter payment routing`, async () => {
        let accesses = 0;
        const env = { GIVEBUTTER_WEBHOOK_SECRET: secret, GIVEBUTTER_WEBHOOK_SIGNATURE_MODE: mode,
          get LEGACY_DB() { accesses++; throw new Error('unsupported event must not access DB'); } };
        const response = await onRequestPost({ env, request: request(payload(event, explicitId), mode) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, ignored: true });
        assert.equal(accesses, 0);
      });
    }
  }

  for (const event of ['plan.failed', 'plan.canceled']) {
    test(`${mode}: signature authentication precedes ignoring ${event}`, async () => {
      let accesses = 0;
      const env = { GIVEBUTTER_WEBHOOK_SECRET: secret, GIVEBUTTER_WEBHOOK_SIGNATURE_MODE: mode,
        get LEGACY_DB() { accesses++; throw new Error('unauthenticated event must not access DB'); } };
      const response = await onRequestPost({ env, request: request(payload(event, true), mode, true) });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { ok: false, error: 'invalid signature' });
      assert.equal(accesses, 0);
    });
  }

  for (const event of ['transaction.succeeded', 'ticket.created', 'donation']) {
    test(`${mode}: ${event} preserves explicit identity and original audit with amount present`, async () => {
      const db = new DatabaseSync(':memory:');
      db.exec(readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8'));
      const env = { GIVEBUTTER_WEBHOOK_SECRET: secret, GIVEBUTTER_WEBHOOK_SIGNATURE_MODE: mode,
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
        const response = await onRequestPost({ env, request: request(payload(event, true), mode) });
        assert.equal(response.status, 200);
        const result = await response.json();
        const row = db.prepare('SELECT * FROM followup').get();
        assert.equal(result.entity_id, row.id);
        assert.equal(row.kind, event === 'ticket.created' ? 'gb_registration' : 'donation');
        assert.equal(row.external_ref, 'synthetic_delivery');
        const audit = db.prepare('SELECT * FROM audit_log').get();
        assert.equal(audit.entity_id, String(row.id));
        assert.equal(audit.action, `webhook.${event}`);
        const retry = await onRequestPost({ env, request: request(payload(event, true), mode) });
        assert.equal((await retry.json()).duplicate, true);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM followup').get().n, 1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, 1);
      } finally { db.close(); }
    });
  }
}
