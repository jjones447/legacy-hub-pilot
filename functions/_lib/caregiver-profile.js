// LP-01 initial storage slice. Option catalog/UI follow the private source packet.
// Email is read-only and always comes from the existing sign-in identity.
// Other contact values are self-reported draft answers, never login identity,
// consent, membership, staff permissions or changes to the caregiver record.
const TEXT_LIMITS = Object.freeze({
  first_name: 120, last_name: 120, phone: 40,
  zip: 10, mailing_address: 500,
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateProfilePatch(body) {
  if (!object(body) || Object.keys(body).some(key => !['revision', 'fields'].includes(key))
      || !Number.isSafeInteger(body.revision) || body.revision < 0
      || body.revision >= Number.MAX_SAFE_INTEGER || !object(body.fields)) return null;
  const entries = Object.entries(body.fields);
  if (!entries.length) return null;
  const fields = {};
  for (const [key, value] of entries) {
    if (!own(TEXT_LIMITS, key) || (value !== null && (typeof value !== 'string'
        || value.length > TEXT_LIMITS[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)))) return null;
    const normalized = value === null ? null : value.trim();
    if (normalized && key === 'zip' && !/^\d{5}(?:-\d{4})?$/.test(normalized)) return null;
    fields[key] = normalized;
  }
  return { revision: body.revision, fields };
}

// One read binds both answers and current caregiver eligibility to the session
// owner. No body/query owner or staff identity is accepted by this interface.
export async function loadCaregiverProfile(db, caregiverId) {
  const row = await db.prepare(`SELECT c.first_name, c.last_name, c.email, c.phone,
      p.revision, p.fields_json, p.updated_at
    FROM caregiver c LEFT JOIN caregiver_profile p ON p.caregiver_id = c.id
    WHERE c.id = ? AND c.status != 'archived'`).bind(caregiverId).first();
  if (!row) return null;
  const fields = row.fields_json === null
    ? { first_name: row.first_name, last_name: row.last_name, phone: row.phone }
    : JSON.parse(row.fields_json);
  // Corrupt or incompatible storage must not expose arbitrary fields.
  if (!object(fields) || Object.keys(fields).some(key => !own(TEXT_LIMITS, key))) throw new Error('profile_storage_invalid');
  return { revision: row.revision ?? 0, fields: { ...fields, email: row.email }, updated_at: row.updated_at ?? null };
}

export async function saveCaregiverProfile(db, caregiverId, patch) {
  const previous = await loadCaregiverProfile(db, caregiverId);
  if (!previous) return { ok: false, status: 401, error: 'unauthorized' };
  if (previous.revision !== patch.revision) return { ok: false, status: 409, error: 'profile_conflict' };
  const nextRevision = patch.revision + 1;
  const { email: _readOnlyEmail, ...previousAnswers } = previous.fields;
  const fields = { ...previousAnswers, ...patch.fields };
  const serialized = JSON.stringify(fields);
  const write = patch.revision === 0
    ? db.prepare(`INSERT INTO caregiver_profile (caregiver_id, revision, fields_json)
        SELECT id, 1, ? FROM caregiver WHERE id = ? AND status != 'archived'
        ON CONFLICT(caregiver_id) DO NOTHING`).bind(serialized, caregiverId)
    : db.prepare(`UPDATE caregiver_profile SET fields_json = ?, revision = ?, updated_at = datetime('now')
        WHERE caregiver_id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM caregiver WHERE id = caregiver_profile.caregiver_id AND status != 'archived')`)
      .bind(serialized, nextRevision, caregiverId, patch.revision);
  // D1 batch is transactional. Audit only the revision, never answer/contact
  // payloads; changes() belongs to the immediately preceding guarded write.
  const results = await db.batch([write,
    db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
      SELECT ?, 'portal.profile_saved', 'caregiver_profile', ?, ? WHERE changes() = 1`)
      .bind(caregiverId, caregiverId, JSON.stringify({ revision: nextRevision })),
  ]);
  if (results?.length !== 2 || results.some(result => result?.success !== true
      || !Number.isInteger(result?.meta?.changes))) throw new Error('profile_save_unknown');
  if (results.every(result => result.meta.changes === 0)) return { ok: false, status: 409, error: 'profile_conflict' };
  if (results.some(result => result.meta.changes !== 1)) throw new Error('profile_save_unknown');
  return { ok: true, revision: nextRevision };
}

// Enforce the actual streamed byte count, not an untrusted Content-Length.
export async function readProfileBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
