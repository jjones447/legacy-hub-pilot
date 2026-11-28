import { loadCaregiverProfile } from './caregiver-profile.js';
import { currentRespiteAckVersions, readRespiteAckVersions } from './respite-acknowledgments.mjs';
import { buildRespiteRequestSnapshot } from './respite-request-snapshot.mjs';

// Owner identity comes from the verified portal session.
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const CREATE_FIELDS = [
  'request_id', 'participant_id', 'participant_revision', 'event_id', 'first_time',
  'caregiver_onsite', 'privacy_ack', 'nonmedical_ack', 'acknowledgment_versions',
];

export function validatePendingRespiteCreate(body) {
  if (!body || Object.getPrototypeOf(body) !== Object.prototype ||
      Reflect.ownKeys(body).length !== CREATE_FIELDS.length ||
      !CREATE_FIELDS.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(body, key) ?? {}, 'value'))) return null;
  if (typeof body.request_id !== 'string' || !/^[-A-Za-z0-9_]{16,80}$/.test(body.request_id) ||
      typeof body.participant_id !== 'string' || !ID.test(body.participant_id) ||
      typeof body.event_id !== 'string' || !ID.test(body.event_id) ||
      !Number.isSafeInteger(body.participant_revision) || body.participant_revision < 1 ||
      typeof body.first_time !== 'boolean' || typeof body.caregiver_onsite !== 'boolean' ||
      body.privacy_ack !== true || body.nonmedical_ack !== true) return null;
  return { ...body };
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const ownerActive = (db, id) => db.prepare("SELECT id FROM caregiver WHERE id=? AND status!='archived'").bind(id).first();
const find = (db, owner, key) => db.prepare(`SELECT r.id,r.event_id,r.participant_id,r.revision,
    r.status,r.needs_review,r.created_at,r.payload_digest
  FROM respite_request r JOIN caregiver c ON c.id=r.caregiver_id
  WHERE r.request_key=? AND r.caregiver_id=? AND c.status!='archived'`).bind(key, owner).first();
const receipt = row => ({
  id: row.id, event_id: row.event_id, participant_id: row.participant_id, revision: row.revision,
  status: row.status, needs_review: Boolean(row.needs_review), created_at: row.created_at,
});

export async function createPendingRespiteRequest(db, ownerId, body) {
  const input = validatePendingRespiteCreate(body);
  if (typeof ownerId !== 'string' || !ID.test(ownerId) || !input) return { ok: false, error: 'invalid_request' };
  // The form echoes the versions it displayed. The policy artifact sets the
  // stored versions independently of the values supplied by the browser.
  if (!currentRespiteAckVersions(input.acknowledgment_versions)) {
    return { ok: false, error: 'new_acknowledgment_required' };
  }
  const versions = readRespiteAckVersions();
  const profile = await loadCaregiverProfile(db, ownerId);
  if (!profile) return { ok: false, error: 'unauthorized' };
  const participant = await db.prepare('SELECT id,revision,details_json FROM respite_participant WHERE id=? AND caregiver_id=?')
    .bind(input.participant_id, ownerId).first();
  if (!participant || participant.revision !== input.participant_revision) {
    return { ok: false, error: 'stale_or_forbidden' };
  }
  const { first_name, last_name, email, phone } = profile.fields;
  const name = [first_name, last_name].filter(part => typeof part === 'string' && part.trim())
    .map(part => part.trim()).join(' ');
  const snapshot = buildRespiteRequestSnapshot(JSON.parse(participant.details_json), { name, email, phone },
    { caregiver_onsite: input.caregiver_onsite });
  if (!snapshot) return { ok: false, error: 'details_unavailable' };

  const key = await hash(JSON.stringify([ownerId, input.request_id]));
  const serialized = JSON.stringify(snapshot);
  const digest = await hash(JSON.stringify([
    input.event_id, participant.id, participant.revision, snapshot, input.first_time,
    versions.privacy, versions.nonmedical,
  ]));
  const reconcile = row => row.payload_digest === digest
    ? { ok: true, ...receipt(row), replayed: true }
    : { ok: false, error: 'idempotency_conflict' };
  const old = await find(db, ownerId, key);
  if (old) return reconcile(old);

  const id = 'rr_' + crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,payload_digest,
        details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at)
        SELECT ?,c.id,?,?,?,?,?,?,?,?,?,datetime('now')
        FROM caregiver c LEFT JOIN caregiver_profile p ON p.caregiver_id=c.id
        WHERE c.id=? AND c.status!='archived' AND c.email IS ? AND COALESCE(p.revision,0)=?
        AND (p.revision IS NOT NULL OR (c.first_name IS ? AND c.last_name IS ? AND c.phone IS ?))`)
        .bind(id, participant.id, input.event_id, key, digest, serialized, participant.revision,
          Number(input.first_time), versions.privacy, versions.nonmedical,
          ownerId, email, profile.revision, first_name ?? null, last_name ?? null, phone ?? null),
      // A zero-row write on late owner or Profile changes must abort even if
      // another statement in this batch could otherwise insert an audit.
      db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json)
        VALUES(CASE WHEN changes()=1 THEN ? ELSE NULL END,'respite.request.pending','respite_request',?,?)`)
        .bind('caregiver:' + ownerId, id, JSON.stringify({
          revision: 1, participant_revision: participant.revision, status: 'pending',
        })),
    ]);
  } catch {
    const winner = await find(db, ownerId, key);
    return winner ? reconcile(winner) : { ok: false, error: 'outcome_unknown' };
  }
  const saved = await find(db, ownerId, key);
  return saved?.payload_digest === digest
    ? { ok: true, ...receipt(saved), replayed: false }
    : { ok: false, error: 'outcome_unknown' };
}

export async function readOwnerRespiteRequests(db, ownerId) {
  if (typeof ownerId !== 'string' || !ID.test(ownerId) || !await ownerActive(db, ownerId)) {
    return { ok: false, error: 'unauthorized' };
  }
  const rows = await db.prepare(`SELECT r.id,r.event_id,r.participant_id,r.revision,r.status,r.needs_review,r.created_at
    FROM respite_request r JOIN caregiver c ON c.id=r.caregiver_id
    WHERE r.caregiver_id=? AND c.status!='archived' ORDER BY r.created_at DESC,r.id DESC LIMIT 50`).bind(ownerId).all();
  if (!await ownerActive(db, ownerId)) return { ok: false, error: 'unauthorized' };
  return { ok: true, requests: rows.results.map(receipt) };
}
