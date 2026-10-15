// LP02-S1: fixed generic help in the existing followup queue, never free text/mail.
// Source-only until separately reviewed and released. Revert the producer to roll
// back; preserve accepted followups and append-only audit records (no migration).
export const SUPPORT_BODY_MAX_BYTES = 256;
export const SUPPORT_SOURCE = 'portal_support_v1';
export const SUPPORT_DETAIL = 'Caregiver requested a support follow-up through the portal.';
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readRequestId(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    return { error: 'unsupported_media_type', status: 415 };
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > SUPPORT_BODY_MAX_BYTES)) {
    return { error: 'invalid_body', status: 413 };
  }
  if (!request.body) return { error: 'invalid_body', status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SUPPORT_BODY_MAX_BYTES) {
        await reader.cancel();
        return { error: 'invalid_body', status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'invalid_body', status: 400 };
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || Array.isArray(body) || typeof body !== 'object'
        || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'request_id')
        || typeof body.request_id !== 'string' || !REQUEST_ID.test(body.request_id)) {
      return { error: 'invalid_body', status: 400 };
    }
    // An opaque UUID v4 only: no user-supplied purpose, owner, contact or detail.
    return { requestId: body.request_id.toLowerCase() };
  } catch {
    return { error: 'invalid_body', status: 400 };
  }
}

export async function handlePortalSupport(request, db, caregiverId) {
  const origin = new URL(request.url).origin;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (request.headers.get('Origin') !== origin
      || (fetchSite !== null && fetchSite !== 'same-origin')) {
    return reply({ ok: false, error: 'forbidden' }, 403);
  }
  const checked = await readRequestId(request);
  if (checked.error) return reply({ ok: false, error: checked.error }, checked.status);
  if (!db || typeof db.batch !== 'function') {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      JSON.stringify([caregiverId, checked.requestId])
    ));
    const externalRef = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    // Existing UNIQUE(source, external_ref) scopes retries to owner + UUID.
    // D1 batch is one serialized SQL transaction: no check-then-insert race,
    // no separate task/audit writes, and a failed statement rolls both back.
    // Recheck archive state INSIDE that transaction, not only before mutation.
    // Only a newly inserted row may acquire the original portal audit. SQLite
    // changes() in the next statement is the preceding INSERT's change count;
    // a conflict is zero, never permission to adopt another producer's row.
    const result = await db.batch([
      db.prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
        SELECT id, 'support_request', ?, ?, ? FROM caregiver
        WHERE id = ? AND status != 'archived'
        ON CONFLICT(source, external_ref) DO NOTHING`)
        .bind(SUPPORT_DETAIL, SUPPORT_SOURCE, externalRef, caregiverId),
      db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id)
        SELECT f.caregiver_id, 'portal.support_requested', 'followup', CAST(f.id AS TEXT)
        FROM followup f JOIN caregiver c ON c.id = f.caregiver_id
        WHERE f.source = ? AND f.external_ref = ? AND f.caregiver_id = ?
          AND f.kind = 'support_request' AND f.detail = ? AND c.status != 'archived'
          AND changes() = 1
          AND NOT EXISTS (SELECT 1 FROM audit_log a
            WHERE a.actor = f.caregiver_id AND a.action = 'portal.support_requested'
              AND a.entity = 'followup' AND a.entity_id = CAST(f.id AS TEXT))`)
        .bind(SUPPORT_SOURCE, externalRef, caregiverId, SUPPORT_DETAIL),
      db.prepare(`SELECT f.id FROM followup f JOIN caregiver c ON c.id = f.caregiver_id
        WHERE f.source = ? AND f.external_ref = ? AND f.caregiver_id = ?
          AND f.kind = 'support_request' AND f.detail = ? AND c.status != 'archived'
          AND EXISTS (SELECT 1 FROM audit_log a
            WHERE a.actor = f.caregiver_id AND a.action = 'portal.support_requested'
              AND a.entity = 'followup' AND a.entity_id = CAST(f.id AS TEXT)
              AND a.before_json IS NULL AND a.after_json IS NULL)`)
        .bind(SUPPORT_SOURCE, externalRef, caregiverId, SUPPORT_DETAIL),
    ]);
    if (!Array.isArray(result) || result.length !== 3 || result.some(r => r.success !== true)) {
      return reply({ ok: false, error: 'unavailable' }, 503);
    }
    if (!Array.isArray(result[2].results)) return reply({ ok: false, error: 'unavailable' }, 503);
    if (!result[2].results.length) return reply({ ok: false, error: 'profile_not_found' }, 404);
    // Same response on first submission and replay, including already-done tasks.
    // A lost response is uncertain: retry ONLY the same UUID, never generate a
    // fresh one automatically. No server-side replay or external provider call.
    return reply({ ok: true }, 202);
  } catch {
    // Do not expose/log SQL, request bodies, identifiers, secrets or customer data.
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
}
