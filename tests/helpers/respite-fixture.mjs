import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readRespiteAckVersions } from '../../functions/_lib/respite-acknowledgments.mjs';

export const participantDetails = Object.freeze({
  participant_name: 'Fictional participant', age: '', relationship: 'Fictional relative',
  mobility: 'None', communication: 'Speak clearly', personal_care_detail: '', safety: '',
  allergies_diet: 'None', activities: 'Puzzles', comfort: '', emergency_name: 'Fictional emergency contact',
  emergency_relationship: 'Relative', emergency_phone: '414-555-0101',
  personal_care_help: false, medication_help: false,
});
export const ownerContact = Object.freeze({ name: 'Fictional Owner', email: 'owner@example.invalid', phone: '414-555-0100' });
export const pendingCommand = (overrides = {}) => ({
  request_id: 'synthetic_request_0001', participant_id: 'p', participant_revision: 1, event_id: 'session',
  first_time: false, caregiver_onsite: true, privacy_ack: true, nonmedical_ack: true,
  acknowledgment_versions: readRespiteAckVersions(), ...overrides,
});

const schema = path => readFileSync(new URL('../../schema/' + path, import.meta.url), 'utf8');
export const selectedRespiteSchema = [
  '0001_init.sql', '0011_staff_member.sql', 'candidates/0022_caregiver_profile.sql',
  'candidates/portal_support_request.sql', 'candidates/respite_owner_lifecycle.sql',
  'candidates/respite_pending_create_guards.sql', 'candidates/respite_staff_eligibility.sql',
  'candidates/respite_pending_eligibility_guard.sql', 'candidates/respite_registration_insert_gate.sql',
  'candidates/respite_registration_update_gate.sql', 'candidates/respite_followup_invalidation.sql',
];

export function respiteFixture({ seedParticipant = true, initialEligibility = true } = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const file of selectedRespiteSchema) {
    // Execute the actual Staff table DDL only. Qualification uses fictional rows.
    raw.exec(file === '0011_staff_member.sql' ? schema(file).split('INSERT OR IGNORE')[0] : schema(file));
  }
  raw.exec(`INSERT INTO caregiver(id,first_name,last_name,email,phone,status) VALUES
    ('owner','Fictional','Owner','owner@example.invalid','414-555-0100','active'),
    ('foreign','Other','Fictional','foreign@example.invalid','414-555-0102','active');
    INSERT INTO staff_member(email) VALUES('staff@example.invalid');
    INSERT INTO event(id,title,type,starts_at,publish_state,capacity,respite_review_required)
      VALUES('session','Fictional session','memory_social','2999-01-01','published',1,1),
            ('session2','Second fictional session','memory_social','2999-02-01','published',1,1);`);
  if (initialEligibility) raw.exec(`INSERT INTO caregiver_profile(caregiver_id,revision,fields_json)
    VALUES('owner',1,'{"first_name":"Fictional","last_name":"Owner","phone":"414-555-0100","respite_interest":"Yes"}')`);
  if (seedParticipant) raw.prepare('INSERT INTO respite_participant(id,caregiver_id,details_json) VALUES(?,?,?)')
    .run('p', 'owner', JSON.stringify(participantDetails));

  const state = { beforeBatch: null, afterRead: null, lostAck: false };
  const db = {
    prepare(sql) {
      const bind = (...args) => ({
        sql, args,
        async first() { return raw.prepare(sql).get(...args) ?? null; },
        async all() {
          const results = raw.prepare(sql).all(...args);
          state.afterRead?.(sql);
          return { results };
        },
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      await state.beforeBatch?.();
      raw.exec('BEGIN');
      let results;
      try {
        results = statements.map(({ sql, args }) => ({ success: true, meta: raw.prepare(sql).run(...args) }));
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      if (state.lostAck) throw new Error('synthetic lost acknowledgment');
      return results;
    },
  };
  return { raw, db, state };
}

export function insertFixturePending(raw, id = 'request', { version = readRespiteAckVersions(), firstTime = false,
  participant = participantDetails, ownerId = 'owner', participantId = 'p', eventId = 'session' } = {}) {
  raw.prepare(`INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,payload_digest,
      details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at)
    VALUES(?,?,?,?,?,'synthetic-digest',?,1,?,?,?,datetime('now'))`).run(
    id, ownerId, participantId, eventId, id,
    JSON.stringify({ participant, caregiver: ownerContact, session: { caregiver_onsite: true } }),
    Number(firstTime), version.privacy, version.nonmedical,
  );
}
