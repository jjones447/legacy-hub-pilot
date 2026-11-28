import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPendingRespiteRequest as create, validatePendingRespiteCreate, readOwnerRespiteRequests }
  from '../functions/_lib/respite-pending-store.mjs';
import { readRespiteAckVersions } from '../functions/_lib/respite-acknowledgments.mjs';
import { createRespiteParticipant, readOwnerRespiteParticipants } from '../functions/_lib/respite-participant-store.mjs';
import { ownerContact, participantDetails, pendingCommand, respiteFixture } from './helpers/respite-fixture.mjs';

async function check(fn, options) {
  const fixture = respiteFixture(options);
  try { await fn(fixture); } finally { fixture.raw.close(); }
}

test('pending body requires typed answers and rejects identity, contact, status, and accessors', () => {
  assert.ok(validatePendingRespiteCreate(pendingCommand()));
  for (const patch of [
    { caregiver_id: 'foreign' }, { contact: ownerContact }, { status: 'confirmed' }, { privacy_ack: false },
    { event_id: 1 }, { participant_revision: '1' }, { first_time: 'yes' }, { caregiver_onsite: 'yes' },
  ]) assert.equal(validatePendingRespiteCreate(pendingCommand(patch)), null);
  const missing = pendingCommand();
  delete missing.caregiver_onsite;
  assert.equal(validatePendingRespiteCreate(missing), null);
  const getter = pendingCommand();
  Object.defineProperty(getter, 'event_id', { get() { assert.fail('read an accessor'); } });
  assert.equal(validatePendingRespiteCreate(getter), null);
});

test('participant create and two pending requests round-trip through the actual composed schema', () => check(async ({ db, raw }) => {
  const participant = await createRespiteParticipant(db, 'owner', {
    request_id: 'synthetic_participant_01', details: participantDetails,
  });
  assert.equal(participant.ok, true);
  const input = pendingCommand({ participant_id: participant.id });
  const a = await create(db, 'owner', input);
  const b = await create(db, 'owner', { ...input, request_id: 'synthetic_request_0002',
    event_id: 'session2', first_time: true, caregiver_onsite: false });
  assert.equal(a.status, 'pending');
  assert.equal(a.needs_review, true);
  assert.equal(b.status, 'pending');
  const stored = raw.prepare('SELECT * FROM respite_request WHERE id=?').get(b.id);
  const snapshot = { participant: participantDetails, caregiver: ownerContact, session: { caregiver_onsite: false } };
  assert.deepEqual(JSON.parse(stored.details_json), snapshot);
  assert.equal(stored.registration_id, null);
  assert.equal(stored.first_time, 1);
  const versions = readRespiteAckVersions();
  assert.equal(stored.privacy_version, versions.privacy);
  assert.equal(stored.nonmedical_version, versions.nonmedical);
  assert.equal(stored.payload_digest, createHash('sha256').update(JSON.stringify([
    'session2', participant.id, 1, snapshot, true, versions.privacy, versions.nonmedical,
  ])).digest('hex'));
  assert.deepEqual((await readOwnerRespiteParticipants(db, 'owner')).participants[0].details, participantDetails);
  assert.deepEqual((await readOwnerRespiteParticipants(db, 'foreign')).participants, []);
  const receipts = (await readOwnerRespiteRequests(db, 'owner')).requests;
  assert.deepEqual(new Set(receipts.map(row => row.id)), new Set([a.id, b.id]));
  assert.ok(receipts.every(row => !Object.hasOwn(row, 'details_json')));
  assert.deepEqual((await readOwnerRespiteRequests(db, 'foreign')).requests, []);
  assert.equal(raw.prepare('SELECT count(*) n FROM registration').get().n, 0);
  const audits = raw.prepare('SELECT after_json FROM audit_log').all();
  assert.equal(audits.length, 3);
  for (const audit of audits) assert.doesNotMatch(audit.after_json, /Fictional|example.invalid|participant_name|caregiver_onsite/);
}, { seedParticipant: false }));

test('same-key replay is stable and changed date, first-time, on-site or contact conflicts', () => check(async ({ db, raw }) => {
  const a = await create(db, 'owner', pendingCommand());
  const b = await create(db, 'owner', pendingCommand());
  assert.deepEqual(b, { ...a, replayed: true });
  for (const change of [{ event_id: 'session2' }, { first_time: true }, { caregiver_onsite: false }]) {
    assert.equal((await create(db, 'owner', pendingCommand(change))).error, 'idempotency_conflict');
  }
  raw.exec("UPDATE caregiver SET email='revised@example.invalid' WHERE id='owner'");
  assert.equal((await create(db, 'owner', pendingCommand())).error, 'idempotency_conflict');
  assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 1);
}));

test('stale rendered versions and forged acknowledgment data produce no writes', () => check(async ({ db, raw }) => {
  const active = readRespiteAckVersions();
  for (const versions of [null, {}, { ...active, privacy: 'draft_test_v1' }, { ...active, extra: true }]) {
    assert.deepEqual(await create(db, 'owner', pendingCommand({ acknowledgment_versions: versions })),
      { ok: false, error: 'new_acknowledgment_required' });
  }
  assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 0);
  assert.equal(raw.prepare('SELECT count(*) n FROM audit_log').get().n, 0);
}));

test('stale or foreign participants and unavailable contact fail before a write', () => check(async ({ db, raw }) => {
  assert.equal((await create(db, 'foreign', pendingCommand())).error, 'stale_or_forbidden');
  assert.equal((await create(db, 'owner', pendingCommand({ participant_revision: 2 }))).error, 'stale_or_forbidden');
  raw.exec("UPDATE caregiver SET email=NULL WHERE id='owner'");
  assert.equal((await create(db, 'owner', pendingCommand())).error, 'details_unavailable');
  assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 0);
}));

// Seed an existing registration before the session is designated as respite.
const existingRegistration = status => `UPDATE event SET respite_review_required=0 WHERE id='session';
  INSERT INTO registration(caregiver_id,event_id,status,source) VALUES('foreign','session','${status}','synthetic');
  UPDATE event SET respite_review_required=1 WHERE id='session';`;

test('owner, contact, Profile, participant, and date races leave no request or audit', async () => {
  for (const sql of [
    "UPDATE caregiver SET status='archived' WHERE id='owner'",
    "UPDATE caregiver SET email='changed@example.invalid' WHERE id='owner'",
    'UPDATE caregiver_profile SET revision=2',
    "UPDATE respite_participant SET revision=2,details_json='{}'",
    "UPDATE event SET publish_state='archived' WHERE id='session'",
    "UPDATE event SET respite_review_required=0 WHERE id='session'",
    "UPDATE event SET capacity=0 WHERE id='session'",
    "UPDATE event SET capacity=NULL WHERE id='session'",
    existingRegistration('registered'), existingRegistration('attended'),
  ]) await check(async ({ db, raw, state }) => {
    state.beforeBatch = () => raw.exec(sql);
    assert.equal((await create(db, 'owner', pendingCommand())).error, 'outcome_unknown');
    assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 0, sql);
    assert.equal(raw.prepare('SELECT count(*) n FROM audit_log').get().n, 0, sql);
  });
});

test('audit failure rolls back; lost acknowledgment reconciles without repeated writes', async () => {
  await check(async ({ db, raw }) => {
    raw.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
    assert.equal((await create(db, 'owner', pendingCommand())).error, 'outcome_unknown');
    assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 0);
  });
  await check(async ({ db, raw, state }) => {
    state.lostAck = true;
    assert.equal((await create(db, 'owner', pendingCommand())).replayed, true);
    assert.equal(raw.prepare('SELECT count(*) n FROM audit_log').get().n, 1);
  });
});

test('cancelled registrations and pending requests consume no capacity', () => check(async ({ db, raw }) => {
  raw.exec(existingRegistration('cancelled'));
  assert.equal((await create(db, 'owner', pendingCommand())).ok, true);
  assert.equal((await create(db, 'owner', pendingCommand({ request_id: 'synthetic_request_0002' }))).ok, true);
  assert.equal(raw.prepare('SELECT count(*) n FROM respite_request').get().n, 2);
  assert.equal(raw.prepare("SELECT count(*) n FROM registration WHERE status IN ('registered','attended')").get().n, 0);
}));

test('initial INSERT rejects flat, foreign participant snapshot, or missing on-site detail', () => check(async ({ raw }) => {
  const insert = raw.prepare(`INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,
    payload_digest,details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at)
    VALUES('raw','owner','p','session','test','digest',?,1,0,?,?,datetime('now'))`);
  const versions = readRespiteAckVersions();
  for (const data of [participantDetails, { participant: { ...participantDetails, participant_name: 'Different' } },
    { participant: participantDetails, caregiver: ownerContact, session: {} }]) {
    assert.throws(() => insert.run(JSON.stringify(data), versions.privacy, versions.nonmedical),
      /participant changed|session snapshot required/);
  }
}));
