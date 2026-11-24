// Domain module for caregiver workflow updates (slice D7-S1).
// Exports validate and apply functions used by both REST PATCH and the agent.

export const ALLOWED_CAREGIVER_UPDATE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'preferred_contact',
  'caring_for',
  'relationship',
  'segment_tags',
  'status',
  'outcome_status',
  'outcome_notes'
];

// Staff-console-only fields (not offered to the assistant mapper): the People search
// "Caregiver?" marker (requester, Nov 12; schema/candidates/0021_caregiver_identity.sql).
// Callers get the original allowlist by default; only the authenticated Staff PATCH route
// opts in with { staffConsole: true }. Assistant drafts are validated without it.
export const STAFF_ONLY_CAREGIVER_UPDATE_FIELDS = ['is_caregiver'];
const updateFieldsFor = staffConsole => staffConsole
  ? [...ALLOWED_CAREGIVER_UPDATE_FIELDS, ...STAFF_ONLY_CAREGIVER_UPDATE_FIELDS]
  : ALLOWED_CAREGIVER_UPDATE_FIELDS;

export const INTERNAL_TEST_SEGMENT_TAGS = Object.freeze(['qa_test', 'exclude_reporting']);
export const INTERNAL_TEST_QUERY_SEGMENTS = Object.freeze(['qa_test', 'exclude_reporting', 'qa_staging', 'qa_prod']);
export const DO_NOT_CONTACT_SEGMENT_TAGS = Object.freeze(['qa_test', 'exclude_reporting', 'do_not_contact']);

export function isInternalTestCaregiverSql(alias = 'c') {
  return `(
    substr(LOWER(TRIM(COALESCE(${alias}.source, ''))), 1, 3) = 'qa_'
    OR EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(${alias}.segment_tags) AND json_type(${alias}.segment_tags) = 'array' THEN ${alias}.segment_tags ELSE '[]' END)
      WHERE value IN ('qa_test', 'exclude_reporting')
    )
  )`;
}

export function notInternalTestCaregiverSql(alias = 'c') {
  return `NOT ${isInternalTestCaregiverSql(alias)}`;
}

export function notDoNotContactCaregiverSql(alias = 'c') {
  return `(
    substr(LOWER(TRIM(COALESCE(${alias}.source, ''))), 1, 3) != 'qa_'
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(${alias}.segment_tags) AND json_type(${alias}.segment_tags) = 'array' THEN ${alias}.segment_tags ELSE '[]' END)
      WHERE value IN ('qa_test', 'exclude_reporting', 'do_not_contact')
    )
  )`;
}

export async function validate(db, { id, operation, payload = {}, staffConsole = false }) {
  const CAREGIVER_UPDATE_FIELDS = updateFieldsFor(staffConsole);
  if (!id) {
    return { ok: false, status: 400, error: 'missing caregiver id' };
  }

  if (operation !== 'update') {
    return { ok: false, status: 400, error: 'unsupported action' };
  }

  const existing = await db
    .prepare('SELECT * FROM caregiver WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) {
    return { ok: false, status: 404, error: 'caregiver not found' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: 'body must be a JSON object' };
  }

  const bodyKeys = Object.keys(payload);
  if (bodyKeys.length === 0) {
    return { ok: false, status: 400, error: 'no update fields provided' };
  }

  for (const key of bodyKeys) {
    if (!CAREGIVER_UPDATE_FIELDS.includes(key)) {
      return { ok: false, status: 400, error: `unknown or forbidden field: ${key}` };
    }
  }

  const normalizedPayload = { ...payload };

  if ('status' in payload) {
    const validStatuses = ['active', 'inactive', 'archived'];
    if (!validStatuses.includes(payload.status)) {
      return { ok: false, status: 400, error: `status must be one of: ${validStatuses.join(', ')}` };
    }
  }

  if ('outcome_status' in payload && payload.outcome_status !== null) {
    const validOutcomes = ['improving', 'stable', 'needs_support', 'disengaged'];
    if (!validOutcomes.includes(payload.outcome_status)) {
      return { ok: false, status: 400, error: `outcome_status must be one of: ${validOutcomes.join(', ')}` };
    }
  }

  if ('is_caregiver' in payload) {
    // People search: 'yes', 'no', or null for not yet identified (requester, Nov 12).
    if (payload.is_caregiver === '' || payload.is_caregiver === undefined) normalizedPayload.is_caregiver = null;
    else if (!['yes', 'no', null].includes(payload.is_caregiver)) {
      return { ok: false, status: 400, error: 'is_caregiver must be yes, no or null' };
    }
  }

  if ('segment_tags' in payload && payload.segment_tags !== null) {
    let tags = payload.segment_tags;
    if (typeof tags === 'string') {
      try {
        tags = JSON.parse(tags);
      } catch (e) {
        return { ok: false, status: 400, error: 'segment_tags must be a JSON array of strings' };
      }
    }
    if (!Array.isArray(tags) || !tags.every(item => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'segment_tags must be a JSON array of strings' };
    }
    normalizedPayload.segment_tags = JSON.stringify(tags);
  }

  const beforeChanges = {};
  const afterChanges = {};
  const projected = { ...existing };

  for (const field of CAREGIVER_UPDATE_FIELDS) {
    if (field in normalizedPayload) {
      beforeChanges[field] = existing[field];
      afterChanges[field] = normalizedPayload[field];
      projected[field] = normalizedPayload[field];
    }
  }

  return {
    ok: true,
    current: existing,
    projected,
    before: beforeChanges,
    after: afterChanges,
    operation: 'update',
    payload: normalizedPayload
  };
}

// Additional statements are supplied only by trusted server callers (not request payloads).
export async function apply(db, { id, operation, payload = {}, staffConsole = false }, actor, additionalStatements = [], preconditions = []) {
  const CAREGIVER_UPDATE_FIELDS = updateFieldsFor(staffConsole);
  const v = await validate(db, { id, operation, payload, staffConsole });
  if (!v.ok) {
    return v;
  }

  const setClauses = [];
  const setParams = [];

  for (const field of CAREGIVER_UPDATE_FIELDS) {
    if (field in v.payload) {
      setClauses.push(`${field} = ?`);
      setParams.push(v.payload[field]);
    }
  }

  const outcomeChanged =
    ('outcome_status' in v.payload && v.payload.outcome_status !== v.current.outcome_status) ||
    ('outcome_notes' in v.payload && v.payload.outcome_notes !== v.current.outcome_notes);

  if (outcomeChanged) {
    setClauses.push("outcome_updated_at = datetime('now')");
  }

  setClauses.push("updated_at = datetime('now')");

  const updateSql = `
    UPDATE caregiver
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `;
  setParams.push(id);

  await db.batch([
    ...preconditions,
    db.prepare(updateSql).bind(...setParams),
    db
    .prepare(`
      INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
      VALUES (?, 'caregiver.update', 'caregiver', ?, ?, ?)
    `)
      .bind(actor, id, JSON.stringify(v.before), JSON.stringify(v.after)),
    ...additionalStatements
  ]);

  const updatedProfile = await db
    .prepare('SELECT * FROM caregiver WHERE id = ?')
    .bind(id)
    .first();

  return {
    ok: true,
    profile: updatedProfile
  };
}

// Record-only staff creation: intake is intentionally not reused because it enrolls or
// creates follow-up work. Keep all rows, including archived matches, for staff review.
const CREATE_FIELDS = ['first_name', 'last_name', 'email', 'phone'];
const PHONE_DIGITS_SQL = "replace(replace(replace(replace(replace(replace(TRIM(COALESCE(phone, '')), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')";
const CONTACT_MATCH_SQL = `((? != '' AND LOWER(TRIM(COALESCE(email, ''))) = ?) OR (? != '' AND ${PHONE_DIGITS_SQL} = ?))`;

async function matchingCaregivers(db, email, phoneDigits, actorKey) {
  const { results } = await db.prepare(`SELECT id, first_name, last_name, email, phone, status FROM caregiver
    WHERE ${CONTACT_MATCH_SQL} AND EXISTS (SELECT 1 FROM staff_member WHERE email = ?
      AND status = 'active' AND role IN ('staff', 'admin')) ORDER BY created_at, id LIMIT 10`)
    .bind(email, email, phoneDigits, phoneDigits, actorKey).all();
  return results || [];
}

export async function create(db, payload, actor) {
  const actorKey = String(actor || '').trim().toLowerCase();
  const member = await db.prepare('SELECT role, status FROM staff_member WHERE email = ?')
    .bind(actorKey).first();
  if (!member || member.status !== 'active' || !['staff', 'admin'].includes(member.role)) {
    return { ok: false, status: 403, error: 'An active staff account is required to add a caregiver.' };
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
      Object.keys(payload).some(key => !CREATE_FIELDS.includes(key))) {
    return { ok: false, status: 400, error: 'Use only name, email and phone for a new caregiver record.' };
  }
  const input = {};
  for (const key of CREATE_FIELDS) {
    if (payload[key] !== undefined && typeof payload[key] !== 'string') {
      return { ok: false, status: 400, error: 'Name and contact fields must be text.' };
    }
    input[key] = (payload[key] || '').trim();
    if (/[\u0000-\u001f\u007f]/.test(input[key]) || input[key].length > ({ email: 254, phone: 40 }[key] || 120)) {
      return { ok: false, status: 400, error: 'Use a shorter name or contact without control characters.' };
    }
  }
  input.email = input.email.toLowerCase();
  if (!input.first_name || (!input.email && !input.phone)) {
    return { ok: false, status: 400, error: 'Enter a first name and at least one email address or phone number.' };
  }
  const phoneDigits = input.phone.replace(/\D/g, '');
  if ((input.email && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(input.email)) ||
      (input.phone && (/[^0-9+(). -]/.test(input.phone) || phoneDigits.length < 7 || phoneDigits.length > 20))) {
    return { ok: false, status: 400, error: 'Enter a valid email address or phone number.' };
  }
  const matches = await matchingCaregivers(db, input.email, phoneDigits, actorKey);
  if (matches.length) return { ok: false, status: 409, error: 'Matching caregiver records already exist. Open the existing person; their history is preserved.', matches };
  const id = 'cg_' + crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT INTO caregiver (id, first_name, last_name, email, phone, source)
      SELECT ?, ?, ?, ?, ?, 'staff' WHERE EXISTS (
        SELECT 1 FROM staff_member WHERE email = ? AND status = 'active' AND role IN ('admin', 'staff')
      ) AND NOT EXISTS (SELECT 1 FROM caregiver WHERE ${CONTACT_MATCH_SQL})`)
      .bind(id, input.first_name, input.last_name || null, input.email || null, input.phone || null,
        actorKey, input.email, input.email, phoneDigits, phoneDigits),
    db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json)
      SELECT ?, 'caregiver.created', 'caregiver', ?, ? WHERE changes() = 1`)
      .bind(actorKey, id, JSON.stringify({ source: 'staff', sanctuary_member: 0 })),
  ]);
  if (results?.[0]?.meta?.changes === 0) {
    const currentMatches = await matchingCaregivers(db, input.email, phoneDigits, actorKey);
    return currentMatches.length
      ? { ok: false, status: 409, error: 'Matching caregiver records already exist. Open the existing person; their history is preserved.', matches: currentMatches }
      : { ok: false, status: 403, error: 'Your staff access changed. Refresh your account before adding a caregiver.' };
  }
  if (!Array.isArray(results) || results.some(r => r.success !== true || r.meta?.changes !== 1)) {
    return { ok: false, status: 503, error: 'The save could not be confirmed. Search for this contact before trying again.' };
  }
  const profile = await db.prepare(`SELECT * FROM caregiver WHERE id = ? AND EXISTS (
    SELECT 1 FROM staff_member WHERE email = ? AND status = 'active' AND role IN ('staff', 'admin')
  )`).bind(id, actorKey).first();
  if (!profile) return { ok: false, status: 503, error: 'The saved record could not be loaded. Search for this contact before trying again.' };
  return { ok: true, status: 201, profile };
}
