import test from 'node:test';
import assert from 'node:assert/strict';
import { readOwnerRespiteView, readStaffPendingRespiteRequests } from '../functions/_lib/respite-views.mjs';
import { respiteSchemaIsReady } from '../functions/_lib/respite-schema.mjs';
import { readRespiteAcknowledgments } from '../functions/_lib/respite-acknowledgments.mjs';
import { createPendingRespiteRequest } from '../functions/_lib/respite-pending-store.mjs';
import { insertFixturePending, ownerContact, pendingCommand, respiteFixture } from './helpers/respite-fixture.mjs';

async function check(fn, options) {
  const fixture = respiteFixture(options);
  try { await fn(fixture); } finally { fixture.raw.close(); }
}

test('preflight requires the selected DDL, not merely expected names', async () => {
  await check(async ({ db, raw }) => {
    assert.equal(await respiteSchemaIsReady(db), true);
    raw.exec(`DROP TRIGGER respite_pending_eligibility_guard;
      CREATE TRIGGER respite_pending_eligibility_guard BEFORE INSERT ON respite_request BEGIN SELECT 1; END;`);
    assert.equal(await respiteSchemaIsReady(db), false);
  });
  await check(async ({ db, raw }) => {
    raw.exec('DROP TABLE caregiver_profile');
    assert.equal(await respiteSchemaIsReady(db), false);
  });
});

test('owner view projects same-owner eligibility, available dates, contact, and bounded summaries', () => check(async ({ db, raw }) => {
  insertFixturePending(raw);
  raw.exec("UPDATE event SET capacity=0 WHERE id='session2'");
  const view = await readOwnerRespiteView(db, 'owner');
  assert.equal(view.visible, true);
  assert.deepEqual(view.dates.map(row => row.id), ['session']);
  assert.deepEqual(view.requests.map(row => row.id), ['request']);
  assert.deepEqual(view.participants, [{ id: 'p', revision: 1, name: 'Fictional participant' }]);
  assert.deepEqual(view.caregiver, ownerContact);
  assert.deepEqual(view.acknowledgments, readRespiteAcknowledgments());
  assert.equal(view.participant_questions.length, 15);
  assert.doesNotMatch(JSON.stringify(view), /Fictional emergency contact|profile_interest_yes|needs_json/);
  assert.deepEqual(await readOwnerRespiteView(db, 'foreign'), { ok: true, visible: false });
  raw.exec("UPDATE caregiver SET status='archived' WHERE id='owner'");
  assert.deepEqual(await readOwnerRespiteView(db, 'owner'), { ok: false, error: 'unauthorized' });
}));

test('cleared Profile answers leave independent Support or Staff eligibility usable', () => check(async ({ raw, db }) => {
  raw.exec(`UPDATE caregiver_profile SET fields_json=json_set(fields_json,'$.respite_interest',null,'$.support_needs','');
    INSERT INTO respite_staff_eligibility(caregiver_id,enabled,revision,updated_by)
      VALUES('owner',1,1,'staff@example.invalid');`);
  assert.equal((await readOwnerRespiteView(db, 'owner')).visible, true);
  raw.exec(`UPDATE respite_staff_eligibility SET enabled=0,revision=2;
    INSERT INTO followup(caregiver_id,kind) VALUES('owner','support_request');`);
  assert.equal((await readOwnerRespiteView(db, 'owner')).visible, false);
  raw.prepare(`INSERT INTO portal_support_request(id,caregiver_id,request_key,payload_digest,needs_json,preferred_contact,followup_id)
    VALUES('support','owner','synthetic_support_request',?,'["break"]','phone',last_insert_rowid())`).run('a'.repeat(64));
  assert.equal((await readOwnerRespiteView(db, 'owner')).visible, true);
  assert.equal((await createPendingRespiteRequest(db, 'owner', pendingCommand())).status, 'pending');
}));

test('Staff pending view checks current role before and after projection and hides private details', () => check(async ({ db, raw, state }) => {
  insertFixturePending(raw);
  const view = await readStaffPendingRespiteRequests(db, 'staff@example.invalid');
  assert.deepEqual(view.requests.map(row => row.id), ['request']);
  assert.equal(view.requests[0].event_title, 'Fictional session');
  assert.doesNotMatch(JSON.stringify(view), /participant|contact|owner@example.invalid|details_json/);
  assert.deepEqual(await readStaffPendingRespiteRequests(db, 'unverified@example.invalid'), { ok: false, error: 'forbidden' });
  state.afterRead = () => raw.exec("UPDATE staff_member SET status='deactivated'");
  assert.deepEqual(await readStaffPendingRespiteRequests(db, 'staff@example.invalid'), { ok: false, error: 'forbidden' });
}));
