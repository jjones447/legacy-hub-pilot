// Daily check-in reminder worker: who gets emailed, once per cycle, and never before go-live.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runReminders, dueCaregivers, reminderEmail } from '../workers/reminders/src/index.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_12 = readFileSync(new URL('../schema/0012_wellness_checkin.sql', import.meta.url), 'utf8');
const TOML = readFileSync(new URL('../workers/reminders/wrangler.toml', import.meta.url), 'utf8');

function d1(db) {
  const wrap = (sql, params) => ({
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...params) }; },
  });
  return { prepare(sql) { return { bind: (...p) => wrap(sql, p), ...wrap(sql, []) }; } };
}

let raw;
let env;
let sent;
const fakeFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_12);
  raw.exec(`INSERT INTO caregiver (id, first_name, last_name, email, source, status) VALUES
    ('due','Ann','A','ann@example.com','seed','active'),
    ('recent','Bo','B','bo@example.com','seed','active'),
    ('never','Cy','C','cy@example.com','seed','active'),
    ('archived','Di','D','di@example.com','seed','archived')`);
  raw.exec(`INSERT INTO wellness_checkin (caregiver_id, answers_json, score, created_at) VALUES
    ('due','{}',50,datetime('now','-40 days')),
    ('recent','{}',50,datetime('now','-5 days')),
    ('archived','{}',50,datetime('now','-60 days'))`);
  env = { LEGACY_DB: d1(raw), EMAIL_API_KEY: 're_test', REMINDERS_ENABLED: '1', PORTAL_URL: 'https://caregiversanctuary.org/portal' };
  sent = [];
});

test('only an active caregiver whose last check-in is 30+ days old is due; never-checked-in people are not', async () => {
  const due = await dueCaregivers(env.LEGACY_DB);
  assert.deepEqual(due.map((c) => c.id), ['due']);
});

test('sends one reminder per cycle and audits it', async () => {
  let r = await runReminders(env, fakeFetch);
  assert.deepEqual(r, { enabled: true, sent: 1, failed: 0 });
  assert.deepEqual(sent[0].to, ['ann@example.com']);
  assert.match(sent[0].text, /https:\/\/caregiversanctuary\.org\/portal/);
  r = await runReminders(env, fakeFetch);
  assert.equal(r.sent, 0, 'no second reminder in the same cycle');
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wellness.reminder_sent'").get().n, 1);
});

test('off unless REMINDERS_ENABLED is "1"; nothing sent without a key or on staging', async () => {
  assert.deepEqual(await runReminders({ ...env, REMINDERS_ENABLED: '0' }, fakeFetch), { enabled: false, sent: 0, failed: 0 });
  assert.equal((await runReminders({ ...env, EMAIL_API_KEY: undefined }, fakeFetch)).sent, 0);
  assert.equal((await runReminders({ ...env, ENVIRONMENT: 'preview' }, fakeFetch)).sent, 0);
  assert.equal(sent.length, 0);
});

test('a failed send is audited as failed and retried next day', async () => {
  const r = await runReminders(env, async () => ({ ok: false, status: 500 }));
  assert.equal(r.failed, 1);
  assert.equal((await dueCaregivers(env.LEGACY_DB)).length, 1, 'still due after a failure');
});

test('config: ships disabled, targets Legacy production DB, runs daily, no public address', () => {
  assert.match(TOML, /REMINDERS_ENABLED = "0"/);
  assert.match(TOML, /database_id = "3c06c3cb-e1a6-426c-ad85-0b8c94616ed2"/);
  assert.match(TOML, /crons = \["0 15 \* \* \*"\]/);
  assert.match(TOML, /workers_dev = false/);
});

test('the email escapes the name', () => {
  assert.match(reminderEmail('<b>x</b>', 'https://x.test/p').html, /&lt;b&gt;x&lt;\/b&gt;/);
});
