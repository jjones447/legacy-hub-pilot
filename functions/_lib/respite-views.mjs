import { loadCaregiverProfile } from './caregiver-profile.js';
import { readRespiteAcknowledgments } from './respite-acknowledgments.mjs';
import { readAvailableRespiteDates } from './respite-date-read.mjs';
import { projectRespiteEligibility } from './respite-eligibility.mjs';
import { respiteParticipantQuestions } from './respite-participant-fields.mjs';
import { readOwnerRespiteParticipants } from './respite-participant-store.mjs';
import { readOwnerRespiteRequests } from './respite-pending-store.mjs';
import { respiteCaregiverContact } from './respite-request-snapshot.mjs';

const OWNER_ID = /^[A-Za-z0-9_-]{1,160}$/;
const unavailable = () => ({ ok: false, error: 'unavailable' });

// Ct13 supplies the verified current owner and checks the selected schema before
// using this view. Eligibility and every record are derived from persisted rows.
export async function readOwnerRespiteView(db, ownerId) {
  if (typeof ownerId !== 'string' || !OWNER_ID.test(ownerId)) return { ok: false, error: 'unauthorized' };
  const profile = await loadCaregiverProfile(db, ownerId);
  if (!profile) return { ok: false, error: 'unauthorized' };

  const support = await db.prepare(`SELECT s.needs_json FROM portal_support_request s
    WHERE s.caregiver_id=? AND EXISTS(SELECT 1 FROM json_each(s.needs_json)
      WHERE type='text' AND value='break') LIMIT 1`).bind(ownerId).first();
  const staff = await db.prepare('SELECT enabled FROM respite_staff_eligibility WHERE caregiver_id=?')
    .bind(ownerId).first();
  const projected = projectRespiteEligibility({
    profileFields: profile.fields,
    supportRequests: support ? [{ needs: JSON.parse(support.needs_json) }] : [],
    staffEnabled: staff ? staff.enabled === 1 : false,
  });
  if (!projected.ok) return unavailable();

  if (!projected.visible) return { ok: true, visible: false };

  const receipts = await readOwnerRespiteRequests(db, ownerId);
  if (!receipts.ok) return receipts;
  const dates = await readAvailableRespiteDates(db, ownerId);
  if (!dates.ok) return dates;
  const participants = await readOwnerRespiteParticipants(db, ownerId);
  if (!participants.ok) return participants;

  return {
    ok: true, visible: true, dates: dates.dates, requests: receipts.requests,
    participants: participants.participants.map(({ id, revision, details }) =>
      ({ id, revision, name: details.participant_name })),
    caregiver: respiteCaregiverContact(profile.fields), acknowledgments: readRespiteAcknowledgments(),
    participant_questions: respiteParticipantQuestions(),
  };
}

const STAFF = "status='active' AND role IN ('staff','admin')";
const staffActive = (db, email) => db.prepare(`SELECT email FROM staff_member WHERE email=? AND ${STAFF}`).bind(email).first();

// The first Staff view exposes pending receipt metadata for triage. Dedicated
// detail, confirmation and other lifecycle actions remain separate.
export async function readStaffPendingRespiteRequests(db, verifiedEmail) {
  if (typeof verifiedEmail !== 'string' || !verifiedEmail || verifiedEmail.length > 254 ||
      !await staffActive(db, verifiedEmail)) return { ok: false, error: 'forbidden' };
  const rows = await db.prepare(`SELECT r.id,r.event_id,r.revision,r.status,r.first_time,r.created_at,
    e.title AS event_title,e.starts_at
    FROM respite_request r JOIN caregiver c ON c.id=r.caregiver_id
    JOIN event e ON e.id=r.event_id
    WHERE c.status!='archived' AND r.status='pending' AND r.removed_at IS NULL
    AND EXISTS(SELECT 1 FROM staff_member WHERE email=? AND ${STAFF})
    ORDER BY r.created_at DESC,r.id DESC LIMIT 50`).bind(verifiedEmail).all();
  if (!await staffActive(db, verifiedEmail)) return { ok: false, error: 'forbidden' };
  return { ok: true, requests: rows.results.map(row => ({ ...row, first_time: Boolean(row.first_time) })) };
}
