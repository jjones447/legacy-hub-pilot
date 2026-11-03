// My Support (LP-02 staged increment): authenticated caregiver support requests,
// owner-scoped saved receipt & history, and Shanelle Staff-queue triage handoff.
// Uses existing D1 tables (followup, audit_log, note, staff_member, caregiver) with
// atomic db.batch transactions — no live schema migration, no email/SMS/external send.

export const SUPPORT_BODY_MAX_BYTES = 4096;
export const SUPPORT_SOURCE = 'portal_support_v1';
export const SHANELLE_STAFF_EMAIL = 'info@legacyhomehealthservices.org';
export const SHANELLE_DISPLAY_NAME = 'Shanelle Snowden';

export const SUPPORT_TYPES = Object.freeze([
  Object.freeze({ code: 'respite_services', label: 'Respite Services' }),
  Object.freeze({ code: 'caregiver_support_guidance', label: 'Caregiver Support & Guidance' }),
  Object.freeze({ code: 'dementia_education_information', label: 'Dementia Education & Information' }),
  Object.freeze({ code: 'community_resources_referrals', label: 'Community Resources & Referrals' }),
  Object.freeze({ code: 'caregiver_wellness_support', label: 'Caregiver Wellness Support' }),
  Object.freeze({ code: 'programs_events', label: 'Programs & Events' }),
  Object.freeze({ code: 'speak_with_team_member', label: 'Speak With a Legacy Team Member' }),
  Object.freeze({ code: 'other', label: 'Other' }),
]);

export const SUPPORT_URGENCY_OPTIONS = Object.freeze([
  Object.freeze({ code: 'as_soon_as_possible', label: 'As soon as possible' }),
  Object.freeze({ code: 'next_few_days', label: 'Next few days' }),
  Object.freeze({ code: 'general_inquiry', label: 'General inquiry' }),
]);

export const SUPPORT_CONTACT_PREFERENCES = Object.freeze([
  Object.freeze({ code: 'phone_call', label: 'Phone Call' }),
  Object.freeze({ code: 'email', label: 'Email' }),
  Object.freeze({ code: 'text_message', label: 'Text Message' }),
]);

export const SUPPORT_STATUS_LABELS = Object.freeze({
  received: 'Received',
  in_progress: 'In Progress',
  completed: 'Completed',
});

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^[0-9+()\-.\s]{7,40}$/;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DETAIL_MAX_LENGTH = 1000;
const NOTE_MAX_LENGTH = 2000;

const ALLOWED_POST_KEYS = new Set([
  'request_id',
  'support_type',
  'urgency',
  'contact_preference',
  'detail',
  'contact_email',
  'contact_phone',
]);

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function resolveOption(options, rawValue) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const opt of options) {
    if (opt.code === lower || opt.label.toLowerCase() === lower) {
      return opt;
    }
  }
  return null;
}

function isValidEmail(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && EMAIL_RE.test(value);
}

function isValidPhone(value) {
  if (typeof value !== 'string' || !PHONE_CHARS_RE.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export async function computeSupportExternalRef(caregiverId, requestId) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([caregiverId, String(requestId).toLowerCase()]))
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computeSupportPayloadHash(normalized) {
  const canonical = JSON.stringify({
    support_type: normalized.supportType.code,
    urgency: normalized.urgency.code,
    contact_preference: normalized.contactPreference.code,
    detail: normalized.detail,
    contact_email: normalized.contactEmail,
    contact_phone: normalized.contactPhone,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatSupportQueueDetail({
  supportTypeLabel,
  urgencyLabel,
  contactPreferenceLabel,
  assignedToName = SHANELLE_DISPLAY_NAME,
  statusLabel = 'Received',
  detail = null,
}) {
  const header = `[My Support · ${supportTypeLabel} · ${urgencyLabel} · Prefer ${contactPreferenceLabel} · Status: ${statusLabel} · Assigned: ${assignedToName}]`;
  return detail ? `${header} ${detail}` : header;
}

async function readBoundedJsonBody(request, maxBytes = SUPPORT_BODY_MAX_BYTES) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    return { error: 'unsupported_media_type', status: 415 };
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
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
      if (size > maxBytes) {
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
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return { error: 'invalid_body', status: 400 };
    }
    return { body };
  } catch {
    return { error: 'invalid_body', status: 400 };
  }
}

export function validatePortalSupportInput(body, profile = {}) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return { error: 'invalid_body', status: 400 };
  }
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !ALLOWED_POST_KEYS.has(k))) {
    return { error: 'invalid_body', status: 400 };
  }
  if (typeof body.request_id !== 'string' || !REQUEST_ID_RE.test(body.request_id)) {
    return { error: 'invalid_body', status: 400 };
  }
  const supportType = resolveOption(SUPPORT_TYPES, body.support_type);
  if (!supportType) {
    return { error: 'invalid_support_type', status: 400 };
  }
  const urgency = resolveOption(SUPPORT_URGENCY_OPTIONS, body.urgency);
  if (!urgency) {
    return { error: 'invalid_urgency', status: 400 };
  }
  const contactPreference = resolveOption(SUPPORT_CONTACT_PREFERENCES, body.contact_preference);
  if (!contactPreference) {
    return { error: 'invalid_contact_preference', status: 400 };
  }

  let detail = null;
  if (body.detail !== undefined && body.detail !== null) {
    if (typeof body.detail !== 'string' || CONTROL_CHAR_RE.test(body.detail)) {
      return { error: 'invalid_detail', status: 400 };
    }
    const trimmedDetail = body.detail.trim();
    if (trimmedDetail.length > DETAIL_MAX_LENGTH) {
      return { error: 'invalid_detail', status: 400 };
    }
    detail = trimmedDetail || null;
  }

  let rawEmail = profile?.email ? String(profile.email).trim() : '';
  if (body.contact_email !== undefined && body.contact_email !== null) {
    if (typeof body.contact_email !== 'string' || CONTROL_CHAR_RE.test(body.contact_email)) {
      return { error: 'invalid_contact', status: 400 };
    }
    const overrideEmail = body.contact_email.trim();
    if (overrideEmail) rawEmail = overrideEmail;
  }
  const contactEmail = rawEmail ? rawEmail.toLowerCase() : null;
  if (contactEmail !== null && !isValidEmail(contactEmail)) {
    return { error: 'invalid_contact', status: 400 };
  }

  let rawPhone = profile?.phone ? String(profile.phone).trim() : '';
  if (body.contact_phone !== undefined && body.contact_phone !== null) {
    if (typeof body.contact_phone !== 'string' || CONTROL_CHAR_RE.test(body.contact_phone)) {
      return { error: 'invalid_contact', status: 400 };
    }
    const overridePhone = body.contact_phone.trim();
    if (overridePhone) rawPhone = overridePhone;
  }
  const contactPhone = rawPhone || null;
  if (contactPhone !== null && !isValidPhone(contactPhone)) {
    return { error: 'invalid_contact', status: 400 };
  }

  if (contactPreference.code === 'email' && !contactEmail) {
    return { error: 'contact_email_required', status: 400 };
  }
  if ((contactPreference.code === 'phone_call' || contactPreference.code === 'text_message') && !contactPhone) {
    return { error: 'contact_phone_required', status: 400 };
  }

  return {
    requestId: body.request_id.toLowerCase(),
    supportType,
    urgency,
    contactPreference,
    detail,
    contactEmail,
    contactPhone,
  };
}

function parseAuditJson(rawJson) {
  if (typeof rawJson !== 'string' || !rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.schema !== SUPPORT_SOURCE) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deriveEffectiveState(row) {
  const initial = parseAuditJson(row.after_json);
  if (!initial || typeof initial.request_id !== 'string' || !REQUEST_ID_RE.test(initial.request_id)) {
    return null;
  }
  const latestStaff = parseAuditJson(row.latest_staff_json);
  const current = latestStaff || initial;

  let status = current.support_status || 'received';
  if (row.followup_status === 'done') {
    status = 'completed';
  } else if (status !== 'received' && status !== 'in_progress' && status !== 'completed') {
    status = 'received';
  }

  const expectedDetail = formatSupportQueueDetail({
    supportTypeLabel: initial.support_type_label,
    urgencyLabel: initial.urgency_label,
    contactPreferenceLabel: initial.contact_preference_label,
    assignedToName: current.assigned_to_name || initial.assigned_to_name || SHANELLE_DISPLAY_NAME,
    statusLabel: SUPPORT_STATUS_LABELS[status] || 'Received',
    detail: initial.detail ?? null,
  });

  // Verify followup.detail matches canonical state so tampered/polluted rows are refused.
  if (row.detail !== expectedDetail) {
    return null;
  }

  const submittedAt = row.created_at || row.audit_at || null;
  const lastStatusUpdatedAt = row.latest_staff_at || submittedAt;
  const latestLifecycleAuditId = latestStaff
    ? Number(row.latest_staff_audit_id) || null
    : Number(row.initial_audit_id) || null;
  const latestStaffBefore = parseAuditJson(row.latest_staff_before_json);

  return {
    followup_id: row.id,
    caregiver_id: row.caregiver_id,
    request_id: initial.request_id,
    payload_hash: initial.payload_hash,
    support_type: initial.support_type,
    support_type_label: initial.support_type_label,
    urgency: initial.urgency,
    urgency_label: initial.urgency_label,
    contact_preference: initial.contact_preference,
    contact_preference_label: initial.contact_preference_label,
    contact_email: initial.contact_email ?? null,
    contact_phone: initial.contact_phone ?? null,
    detail: initial.detail ?? null,
    status,
    status_label: SUPPORT_STATUS_LABELS[status] || 'Received',
    assigned_to: current.assigned_to || initial.assigned_to || SHANELLE_STAFF_EMAIL,
    assigned_to_name: current.assigned_to_name || initial.assigned_to_name || SHANELLE_DISPLAY_NAME,
    version: Number.isInteger(current.version) ? current.version : 1,
    latest_lifecycle_audit_id: latestLifecycleAuditId,
    latest_mutation_id: typeof latestStaffBefore?.mutation_id === 'string' ? latestStaffBefore.mutation_id : null,
    submitted_at: submittedAt,
    last_status_updated_at: lastStatusUpdatedAt,
  };
}

// Strict member-facing whitelist: NEVER exposes private staff notes, assigned_to,
// internal contact logs, external_ref, or audit blobs to a caregiver response.
export function sanitizeMemberSupportItem(state) {
  return Object.freeze({
    request_id: state.request_id,
    support_type: state.support_type,
    support_type_label: state.support_type_label,
    urgency: state.urgency,
    urgency_label: state.urgency_label,
    contact_preference: state.contact_preference,
    contact_preference_label: state.contact_preference_label,
    detail: state.detail,
    status: state.status,
    status_label: state.status_label,
    submitted_at: state.submitted_at,
    last_status_updated_at: state.last_status_updated_at,
  });
}

export async function handlePortalSupport(request, db, caregiverId) {
  const origin = new URL(request.url).origin;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (
    request.headers.get('Origin') !== origin ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  ) {
    return reply({ ok: false, error: 'forbidden' }, 403);
  }

  const rawBody = await readBoundedJsonBody(request, SUPPORT_BODY_MAX_BYTES);
  if (rawBody.error) return reply({ ok: false, error: rawBody.error }, rawBody.status);
  if (!db || typeof db.batch !== 'function' || typeof db.prepare !== 'function') {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }

  try {
    const profile = await db
      .prepare(`SELECT id, first_name, last_name, email, phone, status FROM caregiver WHERE id = ? AND status != 'archived'`)
      .bind(caregiverId)
      .first();
    if (!profile || profile.id !== caregiverId) {
      return reply({ ok: false, error: 'profile_not_found' }, 404);
    }

    const checked = validatePortalSupportInput(rawBody.body, profile);
    if (checked.error) return reply({ ok: false, error: checked.error }, checked.status);

    const externalRef = await computeSupportExternalRef(caregiverId, checked.requestId);
    const payloadHash = await computeSupportPayloadHash(checked);
    const queueDetail = formatSupportQueueDetail({
      supportTypeLabel: checked.supportType.label,
      urgencyLabel: checked.urgency.label,
      contactPreferenceLabel: checked.contactPreference.label,
      assignedToName: SHANELLE_DISPLAY_NAME,
      statusLabel: 'Received',
      detail: checked.detail,
    });
    const initialAuditJson = JSON.stringify({
      schema: SUPPORT_SOURCE,
      request_id: checked.requestId,
      payload_hash: payloadHash,
      support_type: checked.supportType.code,
      support_type_label: checked.supportType.label,
      urgency: checked.urgency.code,
      urgency_label: checked.urgency.label,
      contact_preference: checked.contactPreference.code,
      contact_preference_label: checked.contactPreference.label,
      contact_email: checked.contactEmail,
      contact_phone: checked.contactPhone,
      detail: checked.detail,
      support_status: 'received',
      support_status_label: 'Received',
      assigned_to: SHANELLE_STAFF_EMAIL,
      assigned_to_name: SHANELLE_DISPLAY_NAME,
      version: 1,
    });

    // D1 batch is one serialized SQL transaction:
    // 1. Insert followup scoped to (source, external_ref) if non-archived caregiver exists.
    // 2. Only when changes() = 1 (fresh insert), insert the original portal.support_requested audit.
    // 3. Read back the followup joined to its original portal audit and any latest staff transition.
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
           SELECT id, 'support_request', ?, ?, ? FROM caregiver
           WHERE id = ? AND status != 'archived'
           ON CONFLICT(source, external_ref) DO NOTHING`
        )
        .bind(queueDetail, SUPPORT_SOURCE, externalRef, caregiverId),
      db
        .prepare(
          `INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
           SELECT f.caregiver_id, 'portal.support_requested', 'followup', CAST(f.id AS TEXT), NULL, ?
           FROM followup f JOIN caregiver c ON c.id = f.caregiver_id
           WHERE f.source = ? AND f.external_ref = ? AND f.caregiver_id = ?
             AND f.kind = 'support_request' AND f.detail = ? AND c.status != 'archived'
             AND changes() = 1
             AND NOT EXISTS (
               SELECT 1 FROM audit_log a
               WHERE a.actor = f.caregiver_id AND a.action = 'portal.support_requested'
                 AND a.entity = 'followup' AND a.entity_id = CAST(f.id AS TEXT)
             )`
        )
        .bind(initialAuditJson, SUPPORT_SOURCE, externalRef, caregiverId, queueDetail),
      db
        .prepare(
          `SELECT f.id, f.caregiver_id, f.kind, f.detail, f.status AS followup_status, f.created_at,
                  a.after_json, a.at AS audit_at,
                  (SELECT s.after_json FROM audit_log s
                   WHERE s.action = 'staff.support_request_updated'
                     AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                   ORDER BY s.id DESC LIMIT 1) AS latest_staff_json,
                  (SELECT s.at FROM audit_log s
                   WHERE s.action = 'staff.support_request_updated'
                     AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                   ORDER BY s.id DESC LIMIT 1) AS latest_staff_at
           FROM followup f
           JOIN caregiver c ON c.id = f.caregiver_id
           JOIN audit_log a ON a.actor = f.caregiver_id
             AND a.action = 'portal.support_requested'
             AND a.entity = 'followup'
             AND a.entity_id = CAST(f.id AS TEXT)
             AND a.before_json IS NULL
           WHERE f.source = ? AND f.external_ref = ? AND f.caregiver_id = ?
             AND f.kind = 'support_request' AND c.status != 'archived'
           ORDER BY a.id ASC LIMIT 1`
        )
        .bind(SUPPORT_SOURCE, externalRef, caregiverId),
    ]);

    if (!Array.isArray(result) || result.length !== 3 || result.some((r) => r.success !== true)) {
      return reply({ ok: false, error: 'unavailable' }, 503);
    }
    if (!Array.isArray(result[2].results)) {
      return reply({ ok: false, error: 'unavailable' }, 503);
    }
    if (!result[2].results.length) {
      return reply({ ok: false, error: 'profile_not_found' }, 404);
    }

    const state = deriveEffectiveState(result[2].results[0]);
    if (!state) {
      return reply({ ok: false, error: 'profile_not_found' }, 404);
    }

    // Same-caregiver retry with changed payload must NOT overwrite the original request
    // or return a false confirmation for the altered parameters.
    if (state.payload_hash !== payloadHash) {
      return reply({ ok: false, error: 'request_id_conflict' }, 409);
    }

    return reply({ ok: true, request: sanitizeMemberSupportItem(state) }, 201);
  } catch {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
}

export async function handlePortalSupportGet(request, db, caregiverId) {
  if (!db || typeof db.prepare !== 'function') {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
  try {
    const profile = await db
      .prepare(`SELECT id, email, phone FROM caregiver WHERE id = ? AND status != 'archived'`)
      .bind(caregiverId)
      .first();
    if (!profile || profile.id !== caregiverId) {
      return reply({ ok: false, error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const requestIdParam = url.searchParams.get('request_id');
    if (requestIdParam !== null) {
      if (url.searchParams.getAll('request_id').length !== 1 || !REQUEST_ID_RE.test(requestIdParam)) {
        return reply({ ok: false, error: 'invalid_request_id' }, 400);
      }
      const externalRef = await computeSupportExternalRef(caregiverId, requestIdParam.toLowerCase());
      const row = await db
        .prepare(
          `SELECT f.id, f.caregiver_id, f.kind, f.detail, f.status AS followup_status, f.created_at,
                  a.after_json, a.at AS audit_at,
                  (SELECT s.after_json FROM audit_log s
                   WHERE s.action = 'staff.support_request_updated'
                     AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                   ORDER BY s.id DESC LIMIT 1) AS latest_staff_json,
                  (SELECT s.at FROM audit_log s
                   WHERE s.action = 'staff.support_request_updated'
                     AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                   ORDER BY s.id DESC LIMIT 1) AS latest_staff_at
           FROM followup f
           JOIN audit_log a ON a.actor = f.caregiver_id
             AND a.action = 'portal.support_requested'
             AND a.entity = 'followup'
             AND a.entity_id = CAST(f.id AS TEXT)
             AND a.before_json IS NULL
           WHERE f.caregiver_id = ? AND f.source = ? AND f.external_ref = ?
             AND f.kind = 'support_request'
           ORDER BY a.id ASC LIMIT 1`
        )
        .bind(caregiverId, SUPPORT_SOURCE, externalRef)
        .first();

      if (!row) {
        return reply({ ok: false, error: 'not_found' }, 404);
      }
      const state = deriveEffectiveState(row);
      if (!state) {
        return reply({ ok: false, error: 'not_found' }, 404);
      }
      return reply({ ok: true, request: sanitizeMemberSupportItem(state) }, 200);
    }

    const { results } = await db
      .prepare(
        `SELECT f.id, f.caregiver_id, f.kind, f.detail, f.status AS followup_status, f.created_at,
                a.after_json, a.at AS audit_at,
                (SELECT s.after_json FROM audit_log s
                 WHERE s.action = 'staff.support_request_updated'
                   AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                 ORDER BY s.id DESC LIMIT 1) AS latest_staff_json,
                (SELECT s.at FROM audit_log s
                 WHERE s.action = 'staff.support_request_updated'
                   AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                 ORDER BY s.id DESC LIMIT 1) AS latest_staff_at
         FROM followup f
         JOIN audit_log a ON a.actor = f.caregiver_id
           AND a.action = 'portal.support_requested'
           AND a.entity = 'followup'
           AND a.entity_id = CAST(f.id AS TEXT)
           AND a.before_json IS NULL
         WHERE f.caregiver_id = ? AND f.source = ? AND f.kind = 'support_request'
         ORDER BY f.created_at DESC, f.id DESC`
      )
      .bind(caregiverId, SUPPORT_SOURCE)
      .all();

    const requests = [];
    for (const row of results || []) {
      const state = deriveEffectiveState(row);
      if (state) requests.push(sanitizeMemberSupportItem(state));
    }

    return reply(
      {
        ok: true,
        requests,
        options: {
          support_types: SUPPORT_TYPES,
          urgency_options: SUPPORT_URGENCY_OPTIONS,
          contact_preferences: SUPPORT_CONTACT_PREFERENCES,
        },
        profile_contact: {
          email: profile.email || '',
          phone: profile.phone || '',
        },
      },
      200
    );
  } catch {
    return reply({ ok: false, error: 'unavailable' }, 503);
  }
}

export async function getStaffSupportState(db, followupId) {
  const row = await db
    .prepare(
      `SELECT f.id, f.caregiver_id, f.kind, f.detail, f.status AS followup_status, f.source, f.external_ref, f.created_at,
              a.id AS initial_audit_id, a.after_json, a.at AS audit_at,
              (SELECT s.id FROM audit_log s
               WHERE s.action = 'staff.support_request_updated'
                 AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
               ORDER BY s.id DESC LIMIT 1) AS latest_staff_audit_id,
              (SELECT s.before_json FROM audit_log s
               WHERE s.action = 'staff.support_request_updated'
                 AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
               ORDER BY s.id DESC LIMIT 1) AS latest_staff_before_json,
              (SELECT s.after_json FROM audit_log s
               WHERE s.action = 'staff.support_request_updated'
                 AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
               ORDER BY s.id DESC LIMIT 1) AS latest_staff_json,
              (SELECT s.at FROM audit_log s
               WHERE s.action = 'staff.support_request_updated'
                 AND s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
               ORDER BY s.id DESC LIMIT 1) AS latest_staff_at
       FROM followup f
       LEFT JOIN audit_log a ON a.actor = f.caregiver_id
         AND a.action = 'portal.support_requested'
         AND a.entity = 'followup'
         AND a.entity_id = CAST(f.id AS TEXT)
         AND a.before_json IS NULL
       WHERE f.id = ?`
    )
    .bind(followupId)
    .first();

  if (!row || row.source !== SUPPORT_SOURCE) return null;
  return deriveEffectiveState(row);
}

export async function enrichStaffFollowups(db, followups, { includeReporting = false } = {}) {
  if (!Array.isArray(followups) || followups.length === 0) {
    return { followups: followups || [], shanelleInboxCount: 0 };
  }
  const enriched = [];
  let shanelleInboxCount = 0;

  for (const item of followups) {
    if (item.source !== SUPPORT_SOURCE) {
      enriched.push(item);
      continue;
    }
    const state = await getStaffSupportState(db, item.id);
    if (!state) {
      enriched.push(item);
      continue;
    }
    if (state.status !== 'completed' && state.assigned_to === SHANELLE_STAFF_EMAIL) {
      shanelleInboxCount += 1;
    }
    const supportRequest = {
      request_id: state.request_id,
      support_type: state.support_type,
      support_type_label: state.support_type_label,
      urgency: state.urgency,
      urgency_label: state.urgency_label,
      contact_preference: state.contact_preference,
      contact_preference_label: state.contact_preference_label,
      contact_email: state.contact_email,
      contact_phone: state.contact_phone,
      detail: state.detail,
      status: state.status,
      status_label: state.status_label,
      assigned_to: state.assigned_to,
      assigned_to_name: state.assigned_to_name,
      submitted_at: state.submitted_at,
      last_status_updated_at: state.last_status_updated_at,
      version: state.version,
    };

    if (includeReporting) {
      const { results: noteAudits } = await db
        .prepare(
          `SELECT a.after_json, a.at, n.id AS note_id, n.author, n.body, n.status AS note_status, n.created_at
           FROM audit_log a
           JOIN note n ON CAST(n.id AS TEXT) = json_extract(a.after_json, '$.note_id')
           WHERE a.action = 'staff.support_request_note'
             AND a.entity = 'followup'
             AND a.entity_id = ?
             AND n.caregiver_id = ?
             AND n.status = 'active'
           ORDER BY n.created_at DESC, n.id DESC`
        )
        .bind(String(item.id), state.caregiver_id)
        .all();

      const { results: transitions } = await db
        .prepare(
          `SELECT id, actor, action, before_json, after_json, at
           FROM audit_log
           WHERE entity = 'followup' AND entity_id = ?
             AND action IN ('portal.support_requested', 'staff.support_request_updated', 'staff.support_request_note')
           ORDER BY id ASC`
        )
        .bind(String(item.id))
        .all();

      supportRequest.private_notes = (noteAudits || []).map((n) => ({
        id: n.note_id,
        author: n.author,
        body: n.body,
        created_at: n.created_at,
      }));
      supportRequest.reporting_history = (transitions || []).map((t) => ({
        audit_id: t.id,
        actor: t.actor,
        action: t.action,
        at: t.at,
      }));
    }

    enriched.push({
      ...item,
      support_request: supportRequest,
    });
  }

  return { followups: enriched, shanelleInboxCount };
}

async function resolveVerifiedActiveStaff(db, actor) {
  if (typeof actor !== 'string') return null;
  const email = actor.trim().toLowerCase();
  if (!email || !email.includes('@') || email === 'staff_console' || email === 'dev' || email === 'system') {
    return null;
  }
  try {
    const member = await db
      .prepare(`SELECT email, display_name, role, status FROM staff_member WHERE LOWER(TRIM(email)) = ?`)
      .bind(email)
      .first();
    if (!member || member.status !== 'active') return null;
    return {
      email: member.email.toLowerCase(),
      display_name: member.display_name || member.email,
      role: member.role,
    };
  } catch {
    return null;
  }
}

function isAllowedStatusTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  if (fromStatus === 'received' && (toStatus === 'in_progress' || toStatus === 'completed')) return true;
  if (fromStatus === 'in_progress' && toStatus === 'completed') return true;
  return false;
}

export async function handleStaffSupportMutation(db, actor, followupId, body) {
  if (!db || typeof db.batch !== 'function' || typeof db.prepare !== 'function') {
    return { ok: false, status: 503, error: 'unavailable' };
  }
  const staffActor = await resolveVerifiedActiveStaff(db, actor);
  if (!staffActor) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }

  const allowedKeys = new Set(['status', 'assigned_to', 'expected_version', 'note']);
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !allowedKeys.has(k))) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }

  const state = await getStaffSupportState(db, followupId);
  if (!state) {
    return { ok: false, status: 404, error: 'support_request_not_found' };
  }

  const hasLifecycleChange = body.status !== undefined || body.assigned_to !== undefined;
  const hasNote = body.note !== undefined && body.note !== null;

  if (!hasLifecycleChange && !hasNote) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }

  let noteText = null;
  if (hasNote) {
    if (typeof body.note !== 'string' || CONTROL_CHAR_RE.test(body.note)) {
      return { ok: false, status: 400, error: 'invalid_note' };
    }
    noteText = body.note.trim();
    if (!noteText || noteText.length > NOTE_MAX_LENGTH) {
      return { ok: false, status: 400, error: 'invalid_note' };
    }
  }

  let nextStatus = state.status;
  let nextAssigneeEmail = state.assigned_to;
  let nextAssigneeName = state.assigned_to_name;

  if (body.expected_version !== undefined) {
    if (!Number.isInteger(body.expected_version) || body.expected_version < 1) {
      return { ok: false, status: 400, error: 'expected_version_required' };
    }
    if (body.expected_version !== state.version) {
      return { ok: false, status: 409, error: 'version_conflict' };
    }
  }

  if (hasLifecycleChange) {
    if (!Number.isInteger(body.expected_version) || body.expected_version < 1) {
      return { ok: false, status: 400, error: 'expected_version_required' };
    }
    if (!Number.isInteger(state.latest_lifecycle_audit_id)) {
      return { ok: false, status: 409, error: 'version_conflict' };
    }

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !Object.hasOwn(SUPPORT_STATUS_LABELS, body.status)) {
        return { ok: false, status: 400, error: 'invalid_status' };
      }
      if (!isAllowedStatusTransition(state.status, body.status)) {
        return { ok: false, status: 409, error: `cannot transition support request from ${state.status} to ${body.status}` };
      }
      nextStatus = body.status;
    }

    if (body.assigned_to !== undefined) {
      if (typeof body.assigned_to !== 'string' || !body.assigned_to.trim()) {
        return { ok: false, status: 400, error: 'invalid_assignee' };
      }
      const targetAssignee = await resolveVerifiedActiveStaff(db, body.assigned_to);
      if (!targetAssignee) {
        return { ok: false, status: 400, error: 'invalid_assignee' };
      }
      nextAssigneeEmail = targetAssignee.email;
      nextAssigneeName = targetAssignee.display_name;
    }
  }

  const statements = [];
  const mutationId = crypto.randomUUID();
  const nextFollowupStatus = nextStatus === 'completed' ? 'done' : 'open';
  const currentFollowupStatus = state.status === 'completed' ? 'done' : 'open';
  const currentDetail = formatSupportQueueDetail({
    supportTypeLabel: state.support_type_label,
    urgencyLabel: state.urgency_label,
    contactPreferenceLabel: state.contact_preference_label,
    assignedToName: state.assigned_to_name,
    statusLabel: state.status_label,
    detail: state.detail,
  });
  const nextDetail = formatSupportQueueDetail({
    supportTypeLabel: state.support_type_label,
    urgencyLabel: state.urgency_label,
    contactPreferenceLabel: state.contact_preference_label,
    assignedToName: nextAssigneeName,
    statusLabel: SUPPORT_STATUS_LABELS[nextStatus],
    detail: state.detail,
  });

  if (hasLifecycleChange) {
    const nextVersion = state.version + 1;

    const beforeJson = JSON.stringify({
      schema: SUPPORT_SOURCE,
      request_id: state.request_id,
      support_status: state.status,
      support_status_label: state.status_label,
      assigned_to: state.assigned_to,
      assigned_to_name: state.assigned_to_name,
      version: state.version,
      mutation_id: mutationId,
    });
    const afterJson = JSON.stringify({
      schema: SUPPORT_SOURCE,
      request_id: state.request_id,
      payload_hash: state.payload_hash,
      support_type: state.support_type,
      support_type_label: state.support_type_label,
      urgency: state.urgency,
      urgency_label: state.urgency_label,
      contact_preference: state.contact_preference,
      contact_preference_label: state.contact_preference_label,
      contact_email: state.contact_email,
      contact_phone: state.contact_phone,
      detail: state.detail,
      support_status: nextStatus,
      support_status_label: SUPPORT_STATUS_LABELS[nextStatus],
      assigned_to: nextAssigneeEmail,
      assigned_to_name: nextAssigneeName,
      version: nextVersion,
    });

    statements.push(
      db
        .prepare(
          `UPDATE followup
           SET status = ?, detail = ?
           WHERE id = ? AND source = ? AND status = ? AND detail = ?
             AND EXISTS (
               SELECT 1 FROM staff_member sm
               WHERE LOWER(TRIM(sm.email)) = ? AND sm.status = 'active'
             )
             AND (? = 0 OR EXISTS (
               SELECT 1 FROM staff_member sa
               WHERE LOWER(TRIM(sa.email)) = ? AND sa.status = 'active'
             ))
             AND COALESCE(
               (SELECT s.id FROM audit_log s
                WHERE s.entity = 'followup' AND s.entity_id = CAST(followup.id AS TEXT)
                  AND s.action IN ('portal.support_requested', 'staff.support_request_updated')
                ORDER BY s.id DESC LIMIT 1),
               -1
             ) = ?
             AND COALESCE(
               CAST(
                 json_extract(
                   (SELECT s.after_json FROM audit_log s
                    WHERE s.entity = 'followup' AND s.entity_id = CAST(followup.id AS TEXT)
                      AND s.action IN ('portal.support_requested', 'staff.support_request_updated')
                    ORDER BY s.id DESC LIMIT 1),
                   '$.version'
                 ) AS INTEGER
               ),
               1
             ) = ?`
        )
        .bind(
          nextFollowupStatus,
          nextDetail,
          followupId,
          SUPPORT_SOURCE,
          currentFollowupStatus,
          currentDetail,
          staffActor.email,
          body.assigned_to !== undefined ? 1 : 0,
          nextAssigneeEmail,
          state.latest_lifecycle_audit_id,
          state.version
        ),
      db
        .prepare(
          `INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
           SELECT ?, 'staff.support_request_updated', 'followup', CAST(f.id AS TEXT), ?, ?
           FROM followup f
           WHERE f.id = ? AND f.source = ? AND f.status = ? AND f.detail = ?
             AND changes() = 1
             AND COALESCE(
               (SELECT s.id FROM audit_log s
                WHERE s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                  AND s.action IN ('portal.support_requested', 'staff.support_request_updated')
                ORDER BY s.id DESC LIMIT 1),
               -1
             ) = ?`
        )
        .bind(
          staffActor.email,
          beforeJson,
          afterJson,
          followupId,
          SUPPORT_SOURCE,
          nextFollowupStatus,
          nextDetail,
          state.latest_lifecycle_audit_id
        )
    );
  }

  if (noteText !== null) {
    if (hasLifecycleChange) {
      statements.push(
        db
          .prepare(
            `INSERT INTO note (caregiver_id, author, body, visibility, status)
             SELECT f.caregiver_id, ?, ?, 'staff', 'active'
             FROM followup f
             WHERE f.id = ? AND f.source = ? AND f.status = ? AND f.detail = ?
               AND changes() = 1
               AND COALESCE(
                 json_extract(
                   (SELECT s.before_json FROM audit_log s
                    WHERE s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                      AND s.action = 'staff.support_request_updated'
                    ORDER BY s.id DESC LIMIT 1),
                   '$.mutation_id'
                 ),
                 ''
               ) = ?`
          )
          .bind(
            staffActor.email,
            noteText,
            followupId,
            SUPPORT_SOURCE,
            nextFollowupStatus,
            nextDetail,
            mutationId
          )
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO note (caregiver_id, author, body, visibility, status)
             SELECT f.caregiver_id, ?, ?, 'staff', 'active'
             FROM followup f
             WHERE f.id = ? AND f.source = ?
               AND EXISTS (
                 SELECT 1 FROM staff_member sm
                 WHERE LOWER(TRIM(sm.email)) = ? AND sm.status = 'active'
               )
               AND (? = 0 OR COALESCE(
                 (SELECT s.id FROM audit_log s
                  WHERE s.entity = 'followup' AND s.entity_id = CAST(f.id AS TEXT)
                    AND s.action IN ('portal.support_requested', 'staff.support_request_updated')
                  ORDER BY s.id DESC LIMIT 1),
                 -1
               ) = ?)`
          )
          .bind(
            staffActor.email,
            noteText,
            followupId,
            SUPPORT_SOURCE,
            staffActor.email,
            body.expected_version !== undefined ? 1 : 0,
            state.latest_lifecycle_audit_id ?? -1
          )
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
           SELECT ?, 'staff.support_request_note', 'followup', CAST(? AS TEXT),
                  json_object('schema', ?, 'request_id', ?, 'followup_id', ?, 'note_id', CAST(last_insert_rowid() AS TEXT))
           WHERE changes() = 1`
        )
        .bind(staffActor.email, String(followupId), SUPPORT_SOURCE, state.request_id, followupId)
    );
  }

  const batchResult = await db.batch(statements);
  if (!Array.isArray(batchResult) || batchResult.some((r) => r.success !== true || (r.meta && r.meta.changes === 0))) {
    return { ok: false, status: 409, error: 'version_conflict' };
  }

  const updatedState = await getStaffSupportState(db, followupId);
  if (
    !updatedState ||
    (hasLifecycleChange &&
      (updatedState.version !== state.version + 1 || updatedState.latest_mutation_id !== mutationId))
  ) {
    return { ok: false, status: 409, error: 'version_conflict' };
  }

  const { followups } = await enrichStaffFollowups(
    db,
    [{ id: followupId, source: SUPPORT_SOURCE, caregiver_id: updatedState.caregiver_id }],
    { includeReporting: true }
  );

  return {
    ok: true,
    status: 200,
    support_request: followups[0]?.support_request || null,
  };
}
