// Read-only candidate consumer of schema/candidates/0013_wellness_journey.sql.
// Callers MUST derive identities from verified sessions; these helpers are not authentication.
// No route imports this module. No collection, migration, export or reminder is enabled.
const MAX_PAGE = 50;
const MAX_JSON_BYTES = 65536;
const MAX_PAGE_BYTES = 262144;
const encoder = new TextEncoder();

function identity(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Invalid journey identity.');
  }
  return value;
}
function pageOptions(options, cursorKey, stringCursor = false) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'limit' && key !== cursorKey)) throw new TypeError('Invalid journey page.');
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new TypeError('Invalid journey page.');
  const cursor = options[cursorKey] ?? null;
  if (cursor !== null) {
    if (stringCursor) identity(cursor);
    else if (!Number.isSafeInteger(cursor) || cursor < 1) throw new TypeError('Invalid journey cursor.');
  }
  return { limit, cursor };
}
async function rows(db, sql, bindings, maxRows) {
  try {
    const result = await db.prepare(sql).bind(...bindings).all();
    if (result?.success !== true || !Array.isArray(result.results) || result.results.length > maxRows) throw new Error();
    return result.results;
  } catch {
    // Do not expose SQL, identities, stored answers or adapter error details.
    throw new Error('Journey read unavailable.');
  }
}
function objectJson(text, budget) {
  if (typeof text !== 'string') throw new Error();
  const bytes = encoder.encode(text).byteLength;
  budget.bytes += bytes;
  if (bytes > MAX_JSON_BYTES || budget.bytes > MAX_PAGE_BYTES) throw new Error();
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value;
}
const sequence = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => typeof value === 'string' && value.length > 0 && value.length <= 64;
function binaryCompare(a, b) {
  const left = encoder.encode(a), right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** Latest-first owner history; cursor is the last returned database sequence, not a timestamp. */
export async function readJourneyHistory(db, caregiverId, options = {}) {
  identity(caregiverId);
  const { limit, cursor } = pageOptions(options, 'beforeId');
  const results = await rows(db, `SELECT r.id, r.caregiver_id, r.kind, r.created_at,
      r.questionnaire_id, r.questionnaire_version, r.answers_json, q.snapshot_json,
      p.id AS assignment_id, p.period_id, p.policy_json
    FROM journey_response r
    JOIN caregiver c ON c.id = r.caregiver_id AND c.status = 'active'
    JOIN journey_questionnaire q ON q.questionnaire_id = r.questionnaire_id AND q.version = r.questionnaire_version
    LEFT JOIN journey_period p ON p.id = r.period_assignment_id AND p.caregiver_id = r.caregiver_id
      AND p.questionnaire_id = r.questionnaire_id AND p.questionnaire_version = r.questionnaire_version
    WHERE r.caregiver_id = ? AND (? IS NULL OR r.id < ?)
    ORDER BY r.id DESC LIMIT ?`, [caregiverId, cursor, cursor, limit + 1], limit + 1);
  try {
    const budget = { bytes: 0 };
    let previous = cursor ?? Infinity;
    const items = results.map(row => {
      if (!sequence(row.id) || row.id >= previous || row.caregiver_id !== caregiverId || !timestamp(row.created_at) ||
          !sequence(row.questionnaire_version) || typeof row.questionnaire_id !== 'string') throw new Error();
      previous = row.id;
      const questionnaire = objectJson(row.snapshot_json, budget);
      if (questionnaire.id !== row.questionnaire_id || questionnaire.version !== row.questionnaire_version) throw new Error();
      const answers = objectJson(row.answers_json, budget);
      let period = null;
      if (row.kind === 'quarterly') {
        if (!sequence(row.assignment_id) || !/^[0-9]{4}-Q[1-4]$/u.test(row.period_id)) throw new Error();
        period = { assignmentId: row.assignment_id, id: row.period_id, policy: objectJson(row.policy_json, budget) };
      } else if (row.kind !== 'baseline' || row.assignment_id !== null || row.period_id !== null || row.policy_json !== null) throw new Error();
      return { id: row.id, kind: row.kind, createdAt: row.created_at, questionnaire, answers, period };
    });
    const hasMore = items.length > limit;
    return { items: items.slice(0, limit), nextBeforeId: hasMore ? items[limit - 1].id : null };
  } catch {
    throw new Error('Journey history invalid.');
  }
}

/** Current staff-selected active participants, including those with no response or baseline. */
export async function readSelectedJourneyParticipants(db, staffEmail, options = {}) {
  identity(staffEmail);
  const { limit, cursor } = pageOptions(options, 'afterId', true);
  const results = await rows(db, `SELECT c.id AS caregiver_id, p.id AS selection_id, p.created_at
    FROM caregiver c JOIN journey_participation p ON p.caregiver_id = c.id
    JOIN staff_member s ON s.email = ? AND s.status = 'active'
    WHERE c.status = 'active' AND p.state = 'selected'
      AND p.id = (SELECT MAX(latest.id) FROM journey_participation latest WHERE latest.caregiver_id = c.id)
      AND (? IS NULL OR c.id > ?)
    ORDER BY c.id ASC LIMIT ?`, [staffEmail, cursor, cursor, limit + 1], limit + 1);
  try {
    let previous = cursor;
    const items = results.map(row => {
      identity(row.caregiver_id);
      if ((previous !== null && binaryCompare(row.caregiver_id, previous) <= 0) || !sequence(row.selection_id) || !timestamp(row.created_at)) throw new Error();
      previous = row.caregiver_id;
      return { caregiverId: row.caregiver_id, selectionId: row.selection_id, selectedAt: row.created_at };
    });
    const hasMore = items.length > limit;
    return { items: items.slice(0, limit), nextAfterId: hasMore ? items[limit - 1].caregiverId : null };
  } catch {
    throw new Error('Journey participants invalid.');
  }
}
